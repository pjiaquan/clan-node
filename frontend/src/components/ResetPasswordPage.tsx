import React, { useState } from 'react';
import { useI18n } from '../i18n';

type ResetPasswordPageProps = {
  error?: string | null;
  notice?: string | null;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
};

export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({
  error,
  notice,
  onSubmit,
  onCancel,
}) => {
  const { t } = useI18n();
  const logoSrc = `${import.meta.env.BASE_URL}family_tree_logo.png`;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) {
      setLocalError(t('invite.missing'));
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(t('invite.passwordMismatch'));
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      await onSubmit(password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-logo" src={logoSrc} alt="Family Tree logo" />
        <h1>{t('resetPassword.title')}</h1>
        <p>{t('resetPassword.prompt')}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="reset-password">{t('invite.password')}</label>
            <input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              autoFocus
              required
            />
            <small className="name-lock-hint">{t('invite.passwordPolicy')}</small>
          </div>
          <div className="form-group">
            <label htmlFor="reset-password-confirm">{t('invite.confirmPassword')}</label>
            <input
              id="reset-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {notice && <div className="notice-info">{notice}</div>}
          {(localError || error) && <div className="login-error">{localError || error}</div>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
          </button>
          <button type="button" className="auth-secondary-btn" onClick={onCancel} disabled={submitting}>
            {t('login.backToSignIn')}
          </button>
        </form>
      </div>
    </div>
  );
};
