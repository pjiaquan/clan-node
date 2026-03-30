import React, { useState } from 'react';
import { useI18n } from '../i18n';

type ForgotPasswordPageProps = {
  error?: string | null;
  notice?: string | null;
  onSubmit: (email: string) => Promise<void>;
  onCancel: () => void;
};

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({
  error,
  notice,
  onSubmit,
  onCancel,
}) => {
  const { t } = useI18n();
  const logoSrc = `${import.meta.env.BASE_URL}family_tree_logo.png`;
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(email.trim().toLowerCase());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-logo" src={logoSrc} alt="Family Tree logo" />
        <h1>{t('forgotPassword.title')}</h1>
        <p>{t('forgotPassword.prompt')}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="forgot-password-email">{t('login.email')}</label>
            <input
              id="forgot-password-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          {notice && <div className="notice-info">{notice}</div>}
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
          </button>
          <button type="button" className="auth-secondary-btn" onClick={onCancel} disabled={submitting}>
            {t('login.backToSignIn')}
          </button>
        </form>
      </div>
    </div>
  );
};
