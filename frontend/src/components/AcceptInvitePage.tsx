import React, { useState } from 'react';
import { useI18n } from '../i18n';

type AcceptInvitePageProps = {
  error?: string | null;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
};

export const AcceptInvitePage: React.FC<AcceptInvitePageProps> = ({ error, onSubmit, onCancel }) => {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!password) {
      setLocalError(t('invite.missing'));
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(t('invite.passwordMismatch'));
      return;
    }

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
        <h1>{t('invite.title')}</h1>
        <p>{t('invite.prompt')}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="invite-password">{t('invite.password')}</label>
            <input
              id="invite-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              autoFocus
              required
            />
            <small className="name-lock-hint">{t('invite.passwordPolicy')}</small>
          </div>
          <div className="form-group">
            <label htmlFor="invite-confirm-password">{t('invite.confirmPassword')}</label>
            <input
              id="invite-confirm-password"
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
            {submitting ? t('invite.submitting') : t('invite.submit')}
          </button>
          <button type="button" className="user-admin-btn secondary auth-secondary-btn" onClick={onCancel} disabled={submitting}>
            {t('invite.cancel')}
          </button>
        </form>
      </div>
    </div>
  );
};
