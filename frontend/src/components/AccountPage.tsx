import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AccountProfile, AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';

type AccountPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onManageSessions: () => void;
  onOpenSettings: () => void;
  onManageUsers?: () => void;
  onManageNotifications?: () => void;
  onManageAuditLogs?: () => void;
  onManageRelationshipNames?: () => void;
  onLogout: () => Promise<void> | void;
  onAccountUpdated: (account: AccountProfile) => void;
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

export const AccountPage: React.FC<AccountPageProps> = ({
  currentUser,
  onBack,
  onManageSessions,
  onOpenSettings,
  onManageUsers,
  onManageNotifications,
  onManageAuditLogs,
  onManageRelationshipNames,
  onLogout,
  onAccountUpdated,
}) => {
  const { t, locale } = useI18n();
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState(currentUser.email || currentUser.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const loadAccount = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchAccount();
      setAccount(data);
      setEmail(data.email || data.username);
      onAccountUpdated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [onAccountUpdated, t]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const handleSaveProfile = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateAccount({ email });
      setAccount(updated);
      setEmail(updated.email || updated.username);
      onAccountUpdated(updated);
      setNotice(t('account.profileSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.profileSaveFailed'));
    } finally {
      setBusy(false);
    }
  }, [email, onAccountUpdated, t]);

  const handleAvatarUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.uploadAccountAvatar(file);
      setAccount(updated);
      onAccountUpdated(updated);
      setNotice(t('account.avatarSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.avatarSaveFailed'));
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }, [onAccountUpdated, t]);

  const handleAvatarClear = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateAccount({ avatar_url: null });
      setAccount(updated);
      onAccountUpdated(updated);
      setNotice(t('account.avatarCleared'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.avatarSaveFailed'));
    } finally {
      setBusy(false);
    }
  }, [onAccountUpdated, t]);

  const handleChangePassword = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      setError(t('account.passwordMissing'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('account.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.changeOwnPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice(t('account.passwordSaved', { count: String(result.revoked_other_sessions) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.passwordSaveFailed'));
    } finally {
      setBusy(false);
    }
  }, [confirmPassword, currentPassword, newPassword, t]);

  const avatarSrc = useMemo(
    () => api.resolveAvatarUrl(account?.avatar_url || currentUser.avatar_url || null),
    [account?.avatar_url, currentUser.avatar_url],
  );

  return (
    <div className="session-page">
      <header className="session-header">
        <div className="session-header-left">
          <h1>
            <button type="button" className="header-title-button" onClick={onBack}>
              {t('account.title')}
            </button>
          </h1>
        </div>
        <div className="session-header-right">
          <span className="session-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            currentPage="account"
            isAdmin={currentUser.role === 'admin'}
            onBack={onBack}
            onManageSessions={onManageSessions}
            onOpenSettings={onOpenSettings}
            onManageUsers={onManageUsers}
            onManageNotifications={onManageNotifications}
            onManageAuditLogs={onManageAuditLogs}
            onManageRelationshipNames={onManageRelationshipNames}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="session-main">
        {error && <div className="session-error">{error}</div>}
        {notice && <div className="user-admin-notice">{notice}</div>}
        {loading ? (
          <div className="session-loading">{t('common.loading')}</div>
        ) : (
          <>
            <section className="session-panel account-panel">
              <div className="session-toolbar">
                <strong>{t('account.profileTitle')}</strong>
              </div>
              <div className="account-avatar-row">
                <div className="account-avatar-frame">
                  {avatarSrc ? <img src={avatarSrc} alt={t('account.avatarAlt')} /> : <span>{t('account.avatarEmpty')}</span>}
                </div>
                <div className="account-avatar-actions">
                  <label className="session-btn secondary account-upload-btn">
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleAvatarUpload} disabled={busy} />
                    {t('account.uploadAvatar')}
                  </label>
                  <button type="button" className="session-btn secondary" onClick={handleAvatarClear} disabled={busy || !account?.avatar_url}>
                    {t('account.clearAvatar')}
                  </button>
                </div>
              </div>
              <form className="account-form" onSubmit={handleSaveProfile}>
                <div className="form-group">
                  <label htmlFor="account-email">{t('account.email')}</label>
                  <input
                    id="account-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="account-meta-grid">
                  <div className="account-meta-card">
                    <span>{t('account.role')}</span>
                    <strong>{currentUser.role === 'admin' ? t('userMgmt.roleAdmin') : t('userMgmt.roleReadonly')}</strong>
                  </div>
                  <div className="account-meta-card">
                    <span>{t('account.emailStatus')}</span>
                    <strong>{account?.email_verified_at ? t('userMgmt.emailVerified') : t('userMgmt.emailUnverified')}</strong>
                  </div>
                  <div className="account-meta-card">
                    <span>{t('account.updatedAt')}</span>
                    <strong>{formatDate(account?.updated_at, locale)}</strong>
                  </div>
                </div>
                <button type="submit" className="session-btn secondary" disabled={busy}>
                  {busy ? t('common.saving') : t('account.saveProfile')}
                </button>
              </form>
            </section>

            <section className="session-panel account-panel">
              <div className="session-toolbar">
                <strong>{t('account.passwordTitle')}</strong>
              </div>
              <form className="account-form" onSubmit={handleChangePassword}>
                <div className="form-group">
                  <label htmlFor="account-current-password">{t('account.currentPassword')}</label>
                  <input
                    id="account-current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="account-new-password">{t('account.newPassword')}</label>
                  <input
                    id="account-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <small className="name-lock-hint">{t('invite.passwordPolicy')}</small>
                </div>
                <div className="form-group">
                  <label htmlFor="account-confirm-password">{t('account.confirmPassword')}</label>
                  <input
                    id="account-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <button type="submit" className="session-btn secondary" disabled={busy}>
                  {busy ? t('common.saving') : t('account.savePassword')}
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
};
