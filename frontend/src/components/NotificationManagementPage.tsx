import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, NotificationItem, NotificationStatus, NotificationType } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';

type NotificationManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onManageSessions: () => void;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  onManageUsers: () => void;
  onManageAuditLogs: () => void;
  onManageRelationshipNames: () => void;
  onLogout: () => Promise<void> | void;
};

type NotificationFilterStatus = 'all' | NotificationStatus;

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

export const NotificationManagementPage: React.FC<NotificationManagementPageProps> = ({
  currentUser,
  onBack,
  onManageSessions,
  onOpenAccount,
  onOpenSettings,
  onManageUsers,
  onManageAuditLogs,
  onManageRelationshipNames,
  onLogout,
}) => {
  const { t, locale } = useI18n();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyNotificationId, setBusyNotificationId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<NotificationFilterStatus>('all');

  const loadNotifications = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const data = await api.fetchNotifications(filterStatus === 'all' ? undefined : filterStatus);
      setNotifications(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus, t]);

  useEffect(() => {
    void loadNotifications(false);
  }, [loadNotifications]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'hidden') return;
      if (busyNotificationId) return;
      void loadNotifications(true);
    };

    const timer = window.setInterval(refreshIfVisible, 10000);
    const handleFocus = () => refreshIfVisible();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfVisible();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadNotifications, busyNotificationId]);

  const stats = useMemo(() => {
    const pending = notifications.filter((item) => item.status === 'pending').length;
    const inProgress = notifications.filter((item) => item.status === 'in_progress').length;
    const resolved = notifications.filter((item) => item.status === 'resolved').length;
    const rejected = notifications.filter((item) => item.status === 'rejected').length;
    return {
      total: notifications.length,
      pending,
      inProgress,
      resolved,
      rejected,
    };
  }, [notifications]);

  const handleStatusChange = useCallback(async (notification: NotificationItem, status: NotificationStatus) => {
    if (notification.status === status) return;
    setBusyNotificationId(notification.id);
    setError(null);
    try {
      const updated = await api.updateNotification(notification.id, { status });
      setNotifications((prev) => {
        if (filterStatus !== 'all' && updated.status !== filterStatus) {
          return prev.filter((item) => item.id !== updated.id);
        }
        return prev.map((item) => (item.id === updated.id ? updated : item));
      });
      await loadNotifications(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification.updateFailed'));
    } finally {
      setBusyNotificationId(null);
    }
  }, [filterStatus, loadNotifications, t]);

  const handleDelete = useCallback(async (notification: NotificationItem) => {
    const confirmed = window.confirm(t('notification.deleteConfirm'));
    if (!confirmed) return;

    setBusyNotificationId(notification.id);
    setError(null);
    try {
      await api.deleteNotification(notification.id);
      setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
      await loadNotifications(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification.deleteFailed'));
    } finally {
      setBusyNotificationId(null);
    }
  }, [loadNotifications, t]);

  const statusLabel: Record<NotificationStatus, string> = {
    pending: t('notification.pending'),
    in_progress: t('notification.in_progress'),
    resolved: t('notification.resolved'),
    rejected: t('notification.rejected'),
  };
  const typeLabel: Record<NotificationType, string> = {
    rename: t('notification.type.rename'),
    avatar: t('notification.type.avatar'),
    relationship: t('notification.type.relationship'),
    other: t('notification.type.other'),
  };

  return (
    <div className="notice-page">
      <header className="notice-header">
        <div className="notice-header-left">
          <h1>
            <button type="button" className="header-title-button" onClick={onBack}>
              {t('notification.title')}
            </button>
          </h1>
        </div>
        <div className="notice-header-right">
          <span className="notice-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            currentPage="notifications"
            isAdmin={currentUser.role === 'admin'}
            onBack={onBack}
            onManageSessions={onManageSessions}
            onOpenAccount={onOpenAccount}
            onOpenSettings={onOpenSettings}
            onManageUsers={onManageUsers}
            onManageAuditLogs={onManageAuditLogs}
            onManageRelationshipNames={onManageRelationshipNames}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="notice-main">
        <section className="notice-stats">
          <article className="notice-stat-card">
            <span>{t('notification.total')}</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="notice-stat-card">
            <span>{statusLabel.pending}</span>
            <strong>{stats.pending}</strong>
          </article>
          <article className="notice-stat-card">
            <span>{statusLabel.in_progress}</span>
            <strong>{stats.inProgress}</strong>
          </article>
          <article className="notice-stat-card">
            <span>{statusLabel.resolved}</span>
            <strong>{stats.resolved}</strong>
          </article>
          <article className="notice-stat-card">
            <span>{statusLabel.rejected}</span>
            <strong>{stats.rejected}</strong>
          </article>
        </section>

        <section className="notice-panel">
          <div className="notice-toolbar">
            <select
              className="notice-filter-select"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value as NotificationFilterStatus)}
            >
              <option value="all">{t('notification.allStatuses')}</option>
              <option value="pending">{statusLabel.pending}</option>
              <option value="in_progress">{statusLabel.in_progress}</option>
              <option value="resolved">{statusLabel.resolved}</option>
              <option value="rejected">{statusLabel.rejected}</option>
            </select>
            <button
              type="button"
              className="notice-btn secondary"
              onClick={() => loadNotifications(true)}
              disabled={refreshing}
            >
              {refreshing ? t('common.refreshing') : t('common.refresh')}
            </button>
          </div>

          {error && <div className="notice-error">{error}</div>}

          {loading ? (
            <div className="notice-loading">{t('notification.loading')}</div>
          ) : (
            <div className="notice-table-wrap">
              <table className="notice-table">
                <thead>
                  <tr>
                    <th>{t('notification.createdAt')}</th>
                    <th>{t('notification.status')}</th>
                    <th>{t('notification.type')}</th>
                    <th>{t('notification.targetPerson')}</th>
                    <th>{t('notification.reporter')}</th>
                    <th>{t('notification.message')}</th>
                    <th>{t('notification.handledBy')}</th>
                    <th>{t('notification.handledAt')}</th>
                    <th>{t('notification.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((notification) => {
                    const rowBusy = busyNotificationId === notification.id;
                    return (
                      <tr key={notification.id}>
                        <td>{formatDate(notification.created_at, locale)}</td>
                        <td>
                          <select
                            className="notice-status-select"
                            value={notification.status}
                            onChange={(event) => handleStatusChange(notification, event.target.value as NotificationStatus)}
                            disabled={rowBusy}
                          >
                            <option value="pending">{statusLabel.pending}</option>
                            <option value="in_progress">{statusLabel.in_progress}</option>
                            <option value="resolved">{statusLabel.resolved}</option>
                            <option value="rejected">{statusLabel.rejected}</option>
                          </select>
                        </td>
                        <td>{typeLabel[notification.type]}</td>
                        <td>{notification.target_person_name || notification.target_person_id || '-'}</td>
                        <td>{notification.created_by_username}</td>
                        <td>
                          <div className="notice-message" title={notification.message}>{notification.message}</div>
                        </td>
                        <td>{notification.resolved_by_username || '-'}</td>
                        <td>{formatDate(notification.resolved_at, locale)}</td>
                        <td>
                          <button
                            type="button"
                            className="notice-btn danger"
                            disabled={rowBusy}
                            onClick={() => handleDelete(notification)}
                          >
                            {t('common.delete')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {notifications.length === 0 && (
                    <tr>
                      <td colSpan={9} className="notice-empty">{t('notification.noMatch')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
