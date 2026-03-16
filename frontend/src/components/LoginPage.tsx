import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { PendingMfaChallenge } from '../types';

interface LoginPageProps {
  error?: string | null;
  notice?: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onVerifyMfa?: (code: string) => Promise<void>;
  onUseEmailMfa?: () => Promise<void>;
  onUseTotpMfa?: () => void;
  onCancelMfa?: () => void;
  pendingMfa?: PendingMfaChallenge | null;
  pendingMfaMethod?: 'totp' | 'email';
  onResendVerification?: (email: string) => Promise<void>;
  resendBusy?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  error,
  notice,
  onLogin,
  onVerifyMfa,
  onUseEmailMfa,
  onUseTotpMfa,
  pendingMfa = null,
  pendingMfaMethod = 'email',
  onResendVerification,
  resendBusy = false,
}) => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMfaCode('');
  }, [pendingMfa?.session_id, pendingMfaMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(email.trim().toLowerCase(), password);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onVerifyMfa) return;
    setSubmitting(true);
    try {
      await onVerifyMfa(mfaCode.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const canResend = Boolean(onResendVerification && email.trim());
  const cardStageKey = pendingMfa ? `mfa-card-${pendingMfaMethod}` : 'login-card';

  const handleResend = async () => {
    if (!onResendVerification || !email.trim()) return;
    await onResendVerification(email.trim().toLowerCase());
  };

  return (
    <div className="login-page">
      <div key={cardStageKey} className="login-card">
        <h1>Family Tree</h1>
        <p>{pendingMfa
          ? pendingMfaMethod === 'totp'
            ? t('login.totpPrompt')
            : t('login.mfaPrompt', { email: pendingMfa.masked_email })
          : t('login.prompt')}
        </p>
        {pendingMfa ? (
          <form key={`mfa-form-${pendingMfaMethod}`} onSubmit={handleVerifyMfa}>
            <div className="form-group">
              <label htmlFor="login-mfa-code">{pendingMfaMethod === 'totp' ? t('login.totpCode') : t('login.mfaCode')}</label>
              <input
                id="login-mfa-code"
                name="mfa_code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D+/g, '').slice(0, 6))}
                autoComplete="one-time-code"
                data-1p-ignore="true"
                data-bwignore="true"
                data-lpignore="true"
                autoFocus
                required
              />
            </div>
            {notice && <div className="notice-info">{notice}</div>}
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? t('login.mfaVerifying') : t('login.verifyMfa')}
            </button>
            <div className="login-secondary-actions">
              {pendingMfa.methods.includes('email') && pendingMfaMethod !== 'email' && onUseEmailMfa && (
                <button
                  type="button"
                  className="user-admin-btn secondary"
                  onClick={() => { void onUseEmailMfa(); }}
                  disabled={submitting}
                >
                  {t('login.useEmailFallback')}
                </button>
              )}
              {pendingMfa.methods.includes('totp') && pendingMfaMethod !== 'totp' && onUseTotpMfa && (
                <button
                  type="button"
                  className="user-admin-btn secondary"
                  onClick={onUseTotpMfa}
                  disabled={submitting}
                >
                  {t('login.useAuthenticatorApp')}
                </button>
              )}
            </div>
          </form>
        ) : (
          <form key="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="login-email">{t('login.email')}</label>
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="login-password">{t('login.password')}</label>
              <input
                id="login-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {notice && <div className="notice-info">{notice}</div>}
            {error && <div className="login-error">{error}</div>}
            {error?.toLowerCase().includes('email not verified') && (
              <button
                type="button"
                className="user-admin-btn secondary"
                disabled={!canResend || resendBusy}
                onClick={handleResend}
              >
                {resendBusy ? t('login.resendingVerification') : t('login.resendVerification')}
              </button>
            )}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
