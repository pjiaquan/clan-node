import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, NotificationItem, NotificationStatus, NotificationType } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';

type NotificationManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

type NotificationFilterStatus = 'all' | NotificationStatus;

const STATUS_LABEL: Record<NotificationStatus, string> = {
  pending: '待處理',
  in_progress: '處理中',
  resolved: '已完成',
  rejected: '已拒絕',
};

const TYPE_LABEL: Record<NotificationType, string> = {
  rename: '修改名稱',
  avatar: '修改頭像',
  relationship: '修改關係',
  other: '其他',
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const NotificationManagementPage: React.FC<NotificationManagementPageProps> = ({ currentUser, onBack, onLogout }) => {
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
      setError(err instanceof Error ? err.message : '載入通知失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus]);

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
      setError(err instanceof Error ? err.message : '更新狀態失敗');
    } finally {
      setBusyNotificationId(null);
    }
  }, [filterStatus, loadNotifications]);

  const handleDelete = useCallback(async (notification: NotificationItem) => {
    const confirmed = window.confirm('確定刪除這筆提報？');
    if (!confirmed) return;

    setBusyNotificationId(notification.id);
    setError(null);
    try {
      await api.deleteNotification(notification.id);
      setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
      await loadNotifications(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除提報失敗');
    } finally {
      setBusyNotificationId(null);
    }
  }, [loadNotifications]);

  return (
    <div className="notice-page">
      <header className="notice-header">
        <div className="notice-header-left">
          <h1>通知管理</h1>
        </div>
        <div className="notice-header-right">
          <span className="notice-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            onBack={onBack}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="notice-main">
        <section className="notice-stats">
          <article className="notice-stat-card">
            <span>總提報</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="notice-stat-card">
            <span>待處理</span>
            <strong>{stats.pending}</strong>
          </article>
          <article className="notice-stat-card">
            <span>處理中</span>
            <strong>{stats.inProgress}</strong>
          </article>
          <article className="notice-stat-card">
            <span>已完成</span>
            <strong>{stats.resolved}</strong>
          </article>
          <article className="notice-stat-card">
            <span>已拒絕</span>
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
              <option value="all">全部狀態</option>
              <option value="pending">{STATUS_LABEL.pending}</option>
              <option value="in_progress">{STATUS_LABEL.in_progress}</option>
              <option value="resolved">{STATUS_LABEL.resolved}</option>
              <option value="rejected">{STATUS_LABEL.rejected}</option>
            </select>
            <button
              type="button"
              className="notice-btn secondary"
              onClick={() => loadNotifications(true)}
              disabled={refreshing}
            >
              {refreshing ? '更新中...' : '重新整理'}
            </button>
          </div>

          {error && <div className="notice-error">{error}</div>}

          {loading ? (
            <div className="notice-loading">載入通知中...</div>
          ) : (
            <div className="notice-table-wrap">
              <table className="notice-table">
                <thead>
                  <tr>
                    <th>建立時間</th>
                    <th>狀態</th>
                    <th>問題類型</th>
                    <th>目標人物</th>
                    <th>提出者</th>
                    <th>內容</th>
                    <th>處理者</th>
                    <th>處理時間</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((notification) => {
                    const rowBusy = busyNotificationId === notification.id;
                    return (
                      <tr key={notification.id}>
                        <td>{formatDate(notification.created_at)}</td>
                        <td>
                          <select
                            className="notice-status-select"
                            value={notification.status}
                            onChange={(event) => handleStatusChange(notification, event.target.value as NotificationStatus)}
                            disabled={rowBusy}
                          >
                            <option value="pending">{STATUS_LABEL.pending}</option>
                            <option value="in_progress">{STATUS_LABEL.in_progress}</option>
                            <option value="resolved">{STATUS_LABEL.resolved}</option>
                            <option value="rejected">{STATUS_LABEL.rejected}</option>
                          </select>
                        </td>
                        <td>{TYPE_LABEL[notification.type]}</td>
                        <td>{notification.target_person_name || notification.target_person_id || '-'}</td>
                        <td>{notification.created_by_username}</td>
                        <td>
                          <div className="notice-message" title={notification.message}>{notification.message}</div>
                        </td>
                        <td>{notification.resolved_by_username || '-'}</td>
                        <td>{formatDate(notification.resolved_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="notice-btn danger"
                            disabled={rowBusy}
                            onClick={() => handleDelete(notification)}
                          >
                            刪除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {notifications.length === 0 && (
                    <tr>
                      <td colSpan={9} className="notice-empty">沒有符合條件的提報</td>
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
