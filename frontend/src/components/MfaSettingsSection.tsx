import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthUser, MfaStatus, PasskeyCredentialItem } from '../types';
import { useI18n } from '../i18n';
import {
  createPasskeyCredential,
  defaultPasskeyName,
  encodePasskeyFriendlyName,
  isPasskeySupported,
  passkeyErrorMessage,
} from '../utils/webauthn';

type MfaSettingsSectionProps = {
  currentUser: AuthUser;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
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
  onNotice,
}) => {
  const { t, locale } = useI18n();
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyCredentialItem[]>([]);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [mfaSetupSecret, setMfaSetupSecret] = useState<string | null>(null);
  const [mfaSetupUrl, setMfaSetupUrl] = useState<string | null>(null);
  const [mfaSetupQrUrl, setMfaSetupQrUrl] = useState<string | null>(null);
  const [mfaSetupCode, setMfaSetupCode] = useState('');
  const [mfaSetupExpiresAt, setMfaSetupExpiresAt] = useState<string | null>(null);
  const passkeySupported = isPasskeySupported();

  const loadMfaStatus = useCallback(async () => {
    try {
      setMfaLoading(true);
      const [data, passkeyItems] = await Promise.all([
        api.fetchMfaStatus(),
        api.fetchPasskeys(),
      ]);
      setMfaStatus(data);
      setPasskeys(passkeyItems);
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
        const { default: QRCode } = await import('qrcode');
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
    onNotice(null);
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
  }, [loadMfaStatus, onError, onNotice, t]);

  const handleConfirmTotpSetup = useCallback(async () => {
    if (!mfaSetupCode.trim()) return;
    setMfaBusy(true);
    onError(null);
    onNotice(null);
    try {
      await api.confirmTotpSetup(mfaSetupCode.trim());
      setMfaSetupSecret(null);
      setMfaSetupUrl(null);
      setMfaSetupQrUrl(null);
      setMfaSetupExpiresAt(null);
      setMfaSetupCode('');
      await loadMfaStatus();
      onNotice(t('account.securityTotpReady'));
    } catch (err) {
      onError(err instanceof Error ? err.message : t('account.securityConfirmFailed'));
    } finally {
      setMfaBusy(false);
    }
  }, [loadMfaStatus, mfaSetupCode, onError, onNotice, t]);

  const handleRegisterPasskey = useCallback(async () => {
    if (!passkeySupported) {
      onError(t('account.passkeyUnsupported'));
      return;
    }
    const suggestedName = defaultPasskeyName();
    const enteredName = window.prompt(t('account.passkeyNamePrompt'), suggestedName);
    if (enteredName === null) return;
    const passkeyName = encodePasskeyFriendlyName(enteredName);
    setPasskeyBusy(true);
    onError(null);
    onNotice(null);
    try {
      const options = await api.beginPasskeyRegistration();
      const credential = await createPasskeyCredential(options, passkeyName);
      const result = await api.finishPasskeyRegistration(credential);
      await loadMfaStatus();
      onNotice(t('account.passkeyRegistered', { name: result.name }));
    } catch (err) {
      onError(err instanceof Error ? err.message : passkeyErrorMessage(err));
    } finally {
      setPasskeyBusy(false);
    }
  }, [loadMfaStatus, onError, onNotice, passkeySupported, t]);

  const handleRenamePasskey = useCallback(async (passkey: PasskeyCredentialItem) => {
    const nextName = window.prompt(
      t('account.passkeyRenamePrompt'),
      passkey.name || defaultPasskeyName(),
    );
    if (nextName === null) return;
    const normalizedName = nextName.trim();
    if (!normalizedName) {
      onError(t('account.passkeyNameRequired'));
      return;
    }
    setPasskeyBusy(true);
    onError(null);
    onNotice(null);
    try {
      await api.renamePasskey(passkey.id, normalizedName);
      await loadMfaStatus();
      onNotice(t('account.passkeyRenamed'));
    } catch (err) {
      onError(err instanceof Error ? err.message : t('account.passkeyRenameFailed'));
    } finally {
      setPasskeyBusy(false);
    }
  }, [loadMfaStatus, onError, onNotice, t]);

  const handleDeletePasskey = useCallback(async (passkey: PasskeyCredentialItem) => {
    const confirmed = window.confirm(t('account.passkeyDeleteConfirm', {
      name: passkey.name || passkey.credential_id.slice(0, 8),
    }));
    if (!confirmed) return;
    setPasskeyBusy(true);
    onError(null);
    onNotice(null);
    try {
      await api.deletePasskey(passkey.id);
      await loadMfaStatus();
      onNotice(t('account.passkeyDeleted'));
    } catch (err) {
      onError(err instanceof Error ? err.message : t('account.passkeyDeleteFailed'));
    } finally {
      setPasskeyBusy(false);
    }
  }, [loadMfaStatus, onError, onNotice, t]);

  const describePasskey = (passkey: PasskeyCredentialItem) => {
    const parts = [
      passkey.device_type === 'multi_device' ? t('account.passkeyDeviceSynced') : t('account.passkeyDeviceSingle'),
    ];
    if (passkey.backup_eligible) parts.push(t('account.passkeyBackupEligible'));
    if (passkey.backup_state) parts.push(t('account.passkeyBackupActive'));
    return parts.join(' · ');
  };

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

      <div className="session-toolbar">
        <div>
          <strong>{t('account.passkeyTitle')}</strong>
          <p className="account-section-hint">
            {passkeySupported
              ? t('account.passkeyHint')
              : t('account.passkeyUnsupported')}
          </p>
        </div>
        <button
          type="button"
          className="session-btn secondary"
          onClick={handleRegisterPasskey}
          disabled={passkeyBusy || !passkeySupported}
        >
          {passkeyBusy ? t('session.processing') : t('account.passkeyAdd')}
        </button>
      </div>

      {mfaLoading ? (
        <div className="session-loading">{t('common.loading')}</div>
      ) : (
        <div className="session-mfa-card">
          <p>{t('account.passkeyCount', { count: String(mfaStatus?.passkey_count ?? passkeys.length) })}</p>
          {passkeys.length === 0 ? (
            <p>{t('account.passkeyEmpty')}</p>
          ) : (
            <div className="passkey-list">
              {passkeys.map((passkey) => (
                <article key={passkey.id} className="passkey-card">
                  <div className="passkey-card-head">
                    <div>
                      <strong>{passkey.name || t('account.passkeyUnnamed')}</strong>
                      <p>{describePasskey(passkey)}</p>
                    </div>
                    <div className="passkey-card-actions">
                      <button type="button" className="session-btn ghost" onClick={() => { void handleRenamePasskey(passkey); }} disabled={passkeyBusy}>
                        {t('account.passkeyRename')}
                      </button>
                      <button type="button" className="session-btn danger" onClick={() => { void handleDeletePasskey(passkey); }} disabled={passkeyBusy}>
                        {t('account.passkeyDelete')}
                      </button>
                    </div>
                  </div>
                  <div className="passkey-meta-grid">
                    <span>{t('account.passkeyCreatedAt', { value: formatDate(passkey.created_at, locale) })}</span>
                    <span>{t('account.passkeyLastUsedAt', { value: formatDate(passkey.last_used_at, locale) })}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
