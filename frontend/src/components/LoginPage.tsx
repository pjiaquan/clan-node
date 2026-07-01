import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { PendingMfaChallenge } from '../types';

interface LoginPageProps {
  error?: string | null;
  notice?: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
  onLoginWithPasskey?: () => Promise<void>;
  onVerifyMfa?: (code: string) => Promise<void>;
  onUseEmailMfa?: () => Promise<void>;
  onUseTotpMfa?: () => void;
  onUsePasskeyMfa?: () => Promise<void>;
  onCancelMfa?: () => void;
  pendingMfa?: PendingMfaChallenge | null;
  pendingMfaMethod?: 'totp' | 'email';
  onResendVerification?: (email: string) => Promise<void>;
  resendBusy?: boolean;
  onForgotPassword?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  error,
  notice,
  onLogin,
  onRegister,
  onLoginWithPasskey,
  onVerifyMfa,
  onUseEmailMfa,
  onUseTotpMfa,
  onUsePasskeyMfa,
  pendingMfa = null,
  pendingMfaMethod = 'email',
  onResendVerification,
  resendBusy = false,
  onForgotPassword,
}) => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const logoSrc = `${import.meta.env.BASE_URL}family_tree_logo.png`;

  useEffect(() => {
    setMfaCode('');
  }, [pendingMfa?.session_id, pendingMfaMethod]);

  useEffect(() => {
    setLocalError(null);
    setPassword('');
    setConfirmPassword('');
  }, [isRegistering]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (isRegistering) {
      if (password !== confirmPassword) {
        setLocalError(t('login.passwordsMustMatch'));
        return;
      }
      setSubmitting(true);
      try {
        await onRegister(email.trim().toLowerCase(), password);
        setIsRegistering(false);
      } catch (err) {
        // Parent handleRegister will set authError
      } finally {
        setSubmitting(false);
      }
    } else {
      setSubmitting(true);
      try {
        await onLogin(email.trim().toLowerCase(), password);
      } finally {
        setSubmitting(false);
      }
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
  const cardStageKey = pendingMfa ? `mfa-card-${pendingMfaMethod}` : (isRegistering ? 'register-card' : 'login-card');

  const handleResend = async () => {
    if (!onResendVerification || !email.trim()) return;
    await onResendVerification(email.trim().toLowerCase());
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <div key={cardStageKey} className="login-card">
          <div className="login-logo-shell">
            <img className="login-logo" src={logoSrc} alt="Family Tree logo" />
          </div>
          <div className="login-card-heading">
            <h2>Clan Node</h2>
            <p>{pendingMfa
              ? pendingMfaMethod === 'totp'
                ? t('login.totpPrompt')
                : t('login.mfaPrompt', { email: pendingMfa.masked_email })
              : isRegistering
                ? t('login.registerPrompt')
                : t('login.simplePrompt')}
            </p>
          </div>
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
                {pendingMfa.methods.includes('passkey') && onUsePasskeyMfa && (
                  <button
                    type="button"
                    className="user-admin-btn secondary"
                    onClick={() => { void onUsePasskeyMfa(); }}
                    disabled={submitting}
                  >
                    {t('login.usePasskey')}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form key={isRegistering ? 'register-form' : 'login-form'} onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="login-email">{t('login.username')}</label>
                <input
                  id="login-email"
                  name="email"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
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
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                  required
                />
              </div>
              {isRegistering && (
                <div className="form-group">
                  <label htmlFor="login-confirm-password">{t('login.confirmPassword')}</label>
                  <input
                    id="login-confirm-password"
                    name="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
              )}
              {notice && <div className="notice-info">{notice}</div>}
              {(error || localError) && <div className="login-error">{error || localError}</div>}
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
                {submitting
                  ? (isRegistering ? t('setup.submitting') : t('login.signingIn'))
                  : (isRegistering ? t('login.register') : t('login.signIn'))}
              </button>
              {!isRegistering && onLoginWithPasskey && (
                <button type="button" className="auth-secondary-btn" onClick={() => { void onLoginWithPasskey(); }} disabled={submitting}>
                  {t('login.signInWithPasskey')}
                </button>
              )}
              {!isRegistering && onForgotPassword && (
                <button type="button" className="auth-secondary-btn" onClick={onForgotPassword} disabled={submitting}>
                  {t('login.forgotPassword')}
                </button>
              )}
              <div className="login-toggle-mode" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                <button
                  type="button"
                  className="auth-secondary-btn"
                  onClick={() => setIsRegistering(!isRegistering)}
                  disabled={submitting}
                  style={{ fontSize: '0.9rem', opacity: 0.8 }}
                >
                  {isRegistering ? t('login.alreadyHaveAccount') : t('login.noAccount')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
