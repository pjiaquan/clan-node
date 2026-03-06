import React, { useState } from 'react';
import { useI18n } from '../i18n';

interface ResetUserPasswordModalProps {
  email: string;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}

export const ResetUserPasswordModal: React.FC<ResetUserPasswordModalProps> = ({ email, onClose, onSubmit }) => {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError(t('userMgmt.passwordMissing'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('userMgmt.passwordMismatch'));
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit(password);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('userMgmt.passwordResetFailed');
      setError(message);
      return;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('userMgmt.resetPasswordTitle')}</h2>
        <p className="user-admin-modal-target">{email}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="reset-user-password">{t('userMgmt.newPassword')}</label>
            <input
              id="reset-user-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
            <small className="name-lock-hint">{t('createUser.passwordPolicy')}</small>
          </div>
          <div className="form-group">
            <label htmlFor="reset-user-password-confirm">{t('userMgmt.confirmPassword')}</label>
            <input
              id="reset-user-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </div>
          <div className="user-admin-modal-actions">
            <button type="button" className="user-admin-btn secondary" onClick={onClose} disabled={isSaving}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="user-admin-btn primary" disabled={isSaving}>
              {isSaving ? t('userMgmt.passwordResetting') : t('userMgmt.passwordResetSubmit')}
            </button>
          </div>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
};
