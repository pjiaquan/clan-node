import React, { useState } from 'react';
import { useI18n } from '../i18n';

interface LoginPageProps {
  error?: string | null;
  notice?: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onResendVerification?: (email: string) => Promise<void>;
  resendBusy?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  error,
  notice,
  onLogin,
  onResendVerification,
  resendBusy = false,
}) => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(email.trim().toLowerCase(), password);
    } finally {
      setSubmitting(false);
    }
  };

  const canResend = Boolean(onResendVerification && email.trim());

  const handleResend = async () => {
    if (!onResendVerification || !email.trim()) return;
    await onResendVerification(email.trim().toLowerCase());
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Family Tree</h1>
        <p>{t('login.prompt')}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('login.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label>{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
      </div>
    </div>
  );
};
