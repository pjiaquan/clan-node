import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, ManagedUser, UserRole } from '../types';
import { CreateUserModal } from './CreateUserModal';
import { PageHeaderMenu } from './PageHeaderMenu';
import { ResetUserPasswordModal } from './ResetUserPasswordModal';
import { useI18n } from '../i18n';

type UserManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

export const UserManagementPage: React.FC<UserManagementPageProps> = ({ currentUser, onBack, onLogout }) => {
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<ManagedUser | null>(null);

  const loadUsers = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      setNotice(null);
      const data = await api.fetchUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('userMgmt.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsers(false);
  }, [loadUsers]);

  const stats = useMemo(() => {
    const adminCount = users.filter((user) => user.role === 'admin').length;
    return {
      total: users.length,
      admin: adminCount,
      readonly: users.length - adminCount,
    };
  }, [users]);

  const handleCreateUser = useCallback(async (email: string, password: string, role: UserRole) => {
    await api.createUser(email, password, role);
    setShowCreateModal(false);
    await loadUsers(true);
  }, [loadUsers]);

  const handleRoleChange = useCallback(async (user: ManagedUser, role: UserRole) => {
    if (user.role === role) return;
    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateUser(user.id, { role });
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('userMgmt.updateRoleFailed'));
    } finally {
      setBusyUserId(null);
    }
  }, [t]);

  const handleDeleteUser = useCallback(async (user: ManagedUser) => {
    const confirmed = window.confirm(t('userMgmt.deleteConfirm', { email: user.email || user.username }));
    if (!confirmed) return;
    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    try {
      await api.deleteUser(user.id);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('userMgmt.deleteFailed'));
    } finally {
      setBusyUserId(null);
    }
  }, [t]);

  const handleResetPassword = useCallback(async (user: ManagedUser, password: string) => {
    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    try {
      await api.updateUser(user.id, { password });
      setPasswordTarget(null);
      setNotice(t('userMgmt.passwordResetSuccess', { email: user.email || user.username }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('userMgmt.passwordResetFailed'));
      throw err;
    } finally {
      setBusyUserId(null);
    }
  }, [t]);

  const formatDateTime = useCallback((value: string | null | undefined) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }, [locale]);

  return (
    <div className="user-admin-page">
      <header className="user-admin-header">
        <div className="user-admin-header-left">
          <h1>
            <button type="button" className="header-title-button" onClick={onBack}>
              {t('userMgmt.title')}
            </button>
          </h1>
        </div>
        <div className="user-admin-header-right">
          <span className="user-admin-current-user">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            onBack={onBack}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="user-admin-main">
        <section className="user-admin-stats">
          <article className="user-admin-stat-card">
            <span>{t('userMgmt.total')}</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="user-admin-stat-card">
            <span>{t('userMgmt.admins')}</span>
            <strong>{stats.admin}</strong>
          </article>
          <article className="user-admin-stat-card">
            <span>{t('userMgmt.readonlyUsers')}</span>
            <strong>{stats.readonly}</strong>
          </article>
        </section>

        <section className="user-admin-panel">
          <div className="user-admin-toolbar">
            <button
              type="button"
              className="user-admin-btn secondary"
              onClick={() => loadUsers(true)}
              disabled={refreshing}
            >
              {refreshing ? t('common.refreshing') : t('common.refresh')}
            </button>
            <button
              type="button"
              className="user-admin-btn primary"
              onClick={() => setShowCreateModal(true)}
            >
              {t('userMgmt.createUser')}
            </button>
          </div>

          {error && <div className="user-admin-error">{error}</div>}
          {notice && <div className="user-admin-notice">{notice}</div>}

          {loading ? (
            <div className="user-admin-loading">{t('userMgmt.loading')}</div>
          ) : (
            <div className="user-admin-table-wrap">
              <table className="user-admin-table">
                <thead>
                  <tr>
                    <th>{t('userMgmt.email')}</th>
                    <th>{t('userMgmt.emailStatus')}</th>
                    <th>{t('userMgmt.firstLoginAt')}</th>
                    <th>{t('userMgmt.latestLoginAt')}</th>
                    <th>{t('userMgmt.role')}</th>
                    <th>{t('userMgmt.createdAt')}</th>
                    <th>{t('userMgmt.updatedAt')}</th>
                    <th>{t('userMgmt.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.id === currentUser.id;
                    const rowBusy = busyUserId === user.id;
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="user-admin-username">
                            <span>{user.email || user.username}</span>
                            {isSelf && <span className="user-admin-self-badge">{t('userMgmt.currentUser')}</span>}
                          </div>
                        </td>
                        <td>{user.email_verified_at ? t('userMgmt.emailVerified') : t('userMgmt.emailUnverified')}</td>
                        <td>{formatDateTime(user.first_login_at)}</td>
                        <td>{formatDateTime(user.latest_login_at)}</td>
                        <td>
                          <select
                            className="user-admin-role-select"
                            value={user.role}
                            onChange={(event) => handleRoleChange(user, event.target.value === 'admin' ? 'admin' : 'readonly')}
                            disabled={rowBusy}
                          >
                            <option value="admin">{t('userMgmt.roleAdmin')}</option>
                            <option value="readonly">{t('userMgmt.roleReadonly')}</option>
                          </select>
                        </td>
                        <td>{formatDateTime(user.created_at)}</td>
                        <td>{formatDateTime(user.updated_at)}</td>
                        <td>
                          <div className="user-admin-actions">
                            <button
                              type="button"
                              className="user-admin-btn secondary"
                              disabled={rowBusy}
                              onClick={() => setPasswordTarget(user)}
                            >
                              {t('userMgmt.resetPassword')}
                            </button>
                            <button
                              type="button"
                              className="user-admin-btn danger"
                              disabled={rowBusy || isSelf}
                              onClick={() => handleDeleteUser(user)}
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateUser}
        />
      )}

      {passwordTarget && (
        <ResetUserPasswordModal
          email={passwordTarget.email || passwordTarget.username}
          onClose={() => setPasswordTarget(null)}
          onSubmit={(password) => handleResetPassword(passwordTarget, password)}
        />
      )}
    </div>
  );
};
