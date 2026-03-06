import React, { useState } from 'react';
import { useI18n } from '../i18n';

interface CreateUserModalProps {
  onClose: () => void;
  onSubmit: (email: string, password: string, role: 'admin' | 'readonly') => Promise<void>;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({ onClose, onSubmit }) => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'readonly'>('readonly');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError(t('createUser.missing'));
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit(email.trim().toLowerCase(), password, role);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('createUser.failed');
      setError(message);
      return;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('createUser.title')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new-email">{t('createUser.email')}</label>
            <input
              id="new-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('createUser.emailPlaceholder')}
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-password">{t('createUser.password')}</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('createUser.passwordPlaceholder')}
              autoComplete="new-password"
              minLength={12}
            />
            <small className="name-lock-hint">{t('createUser.passwordPolicy')}</small>
          </div>
          <div className="form-group">
            <label htmlFor="new-role">{t('createUser.role')}</label>
            <select
              id="new-role"
              value={role}
              onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'readonly')}
            >
              <option value="readonly">{t('createUser.roleReadonly')}</option>
              <option value="admin">{t('createUser.roleAdmin')}</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? t('createUser.creating') : t('createUser.submit')}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
};
