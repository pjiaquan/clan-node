import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import type { AuthUser, MfaStatus } from '../types';
import { useI18n } from '../i18n';

type MfaSettingsSectionProps = {
  currentUser: AuthUser;
  onError: (message: string | null) => void;
};

const formatDate = (value: string | null | undefined, locale: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const MfaSettingsSection: React.FC<MfaSettingsSectionProps> = ({
  currentUser,
  onError,
}) => {
  const { t, locale } = useI18n();
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaSetupSecret, setMfaSetupSecret] = useState<string | null>(null);
  const [mfaSetupUrl, setMfaSetupUrl] = useState<string | null>(null);
  const [mfaSetupQrUrl, setMfaSetupQrUrl] = useState<string | null>(null);
  const [mfaSetupCode, setMfaSetupCode] = useState('');
  const [mfaSetupExpiresAt, setMfaSetupExpiresAt] = useState<string | null>(null);

  const loadMfaStatus = useCallback(async () => {
    try {
      setMfaLoading(true);
      const data = await api.fetchMfaStatus();
      setMfaStatus(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : t('account.securityLoadFailed'));
    } finally {
      setMfaLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    loadMfaStatus();
  }, [loadMfaStatus]);

  useEffect(() => {
    let cancelled = false;
    const renderQr = async () => {
      if (!mfaSetupUrl) {
        setMfaSetupQrUrl(null);
        return;
      }
      try {
        const nextUrl = await QRCode.toDataURL(mfaSetupUrl, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 220,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
        if (!cancelled) {
          setMfaSetupQrUrl(nextUrl);
        }
      } catch (error) {
        console.warn('Failed to render MFA QR code:', error);
        if (!cancelled) {
          setMfaSetupQrUrl(null);
        }
      }
    };
    renderQr();
    return () => {
      cancelled = true;
    };
  }, [mfaSetupUrl]);

  const handleStartTotpSetup = useCallback(async () => {
    setMfaBusy(true);
    onError(null);
    try {
      const data = await api.startTotpSetup();
      setMfaSetupSecret(data.secret);
      setMfaSetupUrl(data.otpauth_url);
      setMfaSetupExpiresAt(data.expires_at);
      setMfaSetupCode('');
      await loadMfaStatus();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('account.securitySetupFailed'));
    } finally {
      setMfaBusy(false);
    }
  }, [loadMfaStatus, onError, t]);

  const handleConfirmTotpSetup = useCallback(async () => {
    if (!mfaSetupCode.trim()) return;
    setMfaBusy(true);
    onError(null);
    try {
      await api.confirmTotpSetup(mfaSetupCode.trim());
      setMfaSetupSecret(null);
      setMfaSetupUrl(null);
      setMfaSetupQrUrl(null);
      setMfaSetupExpiresAt(null);
      setMfaSetupCode('');
      await loadMfaStatus();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('account.securityConfirmFailed'));
    } finally {
      setMfaBusy(false);
    }
  }, [loadMfaStatus, mfaSetupCode, onError, t]);

  return (
    <section className="session-panel account-panel">
      <div className="session-toolbar">
        <div>
          <strong>{t('account.securityTitle')}</strong>
          <p className="account-section-hint">{t('account.securityHint')}</p>
        </div>
        <button
          type="button"
          className="session-btn secondary"
          onClick={handleStartTotpSetup}
          disabled={mfaBusy}
        >
          {mfaBusy
            ? t('session.processing')
            : (mfaStatus?.totp_enabled ? t('account.securityRotate') : t('account.securitySetup'))}
        </button>
      </div>

      {mfaLoading ? (
        <div className="session-loading">{t('common.loading')}</div>
      ) : (
        <div className="session-mfa-card">
          <p>{mfaStatus?.totp_enabled ? t('account.securityEnabled') : t('account.securityNotEnabled')}</p>
          <p>
            {mfaStatus?.email_fallback_enabled
              ? t('account.securityEmailFallback', { email: mfaStatus?.masked_email || currentUser.email || currentUser.username })
              : t('account.securityNoEmailFallback')}
          </p>
          {mfaStatus?.totp_enabled_at && <p>{t('account.securityEnabledAt', { value: formatDate(mfaStatus.totp_enabled_at, locale) })}</p>}
          {mfaSetupSecret && (
            <div className="session-mfa-setup">
              <div className="session-mfa-qr-wrap">
                {mfaSetupQrUrl ? (
                  <img
                    className="session-mfa-qr"
                    src={mfaSetupQrUrl}
                    alt={t('account.securityQrAlt')}
                  />
                ) : (
                  <div className="session-mfa-qr-fallback">{t('account.securityQrFailed')}</div>
                )}
              </div>
              <div className="form-group">
                <label>{t('account.securityManualKey')}</label>
                <input type="text" value={mfaSetupSecret} readOnly />
              </div>
              <div className="form-group">
                <label>{t('account.securityOtpAuthUrl')}</label>
                <textarea value={mfaSetupUrl || ''} readOnly />
              </div>
              {mfaSetupExpiresAt && <p>{t('account.securitySetupExpiresAt', { value: formatDate(mfaSetupExpiresAt, locale) })}</p>}
              <div className="form-group">
                <label>{t('account.securityConfirmCode')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={mfaSetupCode}
                  onChange={(event) => setMfaSetupCode(event.target.value.replace(/\D+/g, '').slice(0, 6))}
                />
              </div>
              <button
                type="button"
                className="session-btn secondary"
                onClick={handleConfirmTotpSetup}
                disabled={mfaBusy || mfaSetupCode.trim().length !== 6}
              >
                {mfaBusy ? t('session.processing') : t('account.securityConfirmSetup')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
