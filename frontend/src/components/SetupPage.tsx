import React, { useState } from 'react';
import { useI18n } from '../i18n';

type SetupPageProps = {
  error?: string | null;
  onSetup: (email: string, password: string) => Promise<void>;
};

export const SetupPage: React.FC<SetupPageProps> = ({ error, onSetup }) => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError(t('setup.missing'));
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(t('setup.passwordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await onSetup(email.trim().toLowerCase(), password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.prompt')}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('setup.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label>{t('setup.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
            <small className="name-lock-hint">{t('setup.passwordPolicy')}</small>
          </div>
          <div className="form-group">
            <label>{t('setup.confirmPassword')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </div>
          {(localError || error) && <div className="login-error">{localError || error}</div>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? t('setup.submitting') : t('setup.submit')}
          </button>
        </form>
      </div>
    </div>
  );
};
