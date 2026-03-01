import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthSession, AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';

type SessionManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
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

const platformGroup = (session: AuthSession) => {
  const p = session.platform.toLowerCase();
  if (p.includes('android') || p.includes('ios')) return 'mobile';
  if (p.includes('windows') || p.includes('mac') || p.includes('linux')) return 'desktop';
  return 'other';
};

export const SessionManagementPage: React.FC<SessionManagementPageProps> = ({ currentUser, onBack, onLogout }) => {
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const loadSessions = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const data = await api.fetchSessions();
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入 session 失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSessions(false);
  }, [loadSessions]);

  const stats = useMemo(() => {
    const mobile = sessions.filter((item) => platformGroup(item) === 'mobile').length;
    const desktop = sessions.filter((item) => platformGroup(item) === 'desktop').length;
    const other = sessions.length - mobile - desktop;
    return { total: sessions.length, mobile, desktop, other };
  }, [sessions]);

  const handleRevokeSession = useCallback(async (session: AuthSession) => {
    const confirmed = window.confirm(`確定要下線這個裝置？\n${session.device_label}`);
    if (!confirmed) return;

    setBusySessionId(session.id);
    setError(null);
    try {
      const result = await api.revokeSession(session.id);
      if (result.current) {
        await onLogout();
        return;
      }
      setSessions((prev) => prev.filter((item) => item.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '下線失敗');
    } finally {
      setBusySessionId(null);
    }
  }, [onLogout]);

  const handleRevokeOthers = useCallback(async () => {
    const confirmed = window.confirm('確定下線其他所有裝置？');
    if (!confirmed) return;
    setRevokingOthers(true);
    setError(null);
    try {
      await api.revokeOtherSessions();
      await loadSessions(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下線其他裝置失敗');
    } finally {
      setRevokingOthers(false);
    }
  }, [loadSessions]);

  return (
    <div className="session-page">
      <header className="session-header">
        <div className="session-header-left">
          <h1>登入裝置 Session</h1>
        </div>
        <div className="session-header-right">
          <span className="session-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            onBack={onBack}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="session-main">
        <section className="session-stats">
          <article className="session-stat-card">
            <span>總 Session</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="session-stat-card">
            <span>桌面裝置</span>
            <strong>{stats.desktop}</strong>
          </article>
          <article className="session-stat-card">
            <span>行動裝置</span>
            <strong>{stats.mobile}</strong>
          </article>
          <article className="session-stat-card">
            <span>其他</span>
            <strong>{stats.other}</strong>
          </article>
        </section>

        <section className="session-panel">
          <div className="session-toolbar">
            <button
              type="button"
              className="session-btn secondary"
              onClick={() => loadSessions(true)}
              disabled={refreshing}
            >
              {refreshing ? '更新中...' : '重新整理'}
            </button>
            <button
              type="button"
              className="session-btn danger"
              onClick={handleRevokeOthers}
              disabled={revokingOthers}
            >
              {revokingOthers ? '處理中...' : '下線其他裝置'}
            </button>
          </div>

          {error && <div className="session-error">{error}</div>}

          {loading ? (
            <div className="session-loading">載入中...</div>
          ) : (
            <div className="session-table-wrap">
              <table className="session-table">
                <thead>
                  <tr>
                    <th>裝置</th>
                    <th>瀏覽器</th>
                    <th>IP</th>
                    <th>最近活動</th>
                    <th>登入時間</th>
                    <th>到期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const rowBusy = busySessionId === session.id;
                    return (
                      <tr key={session.id}>
                        <td>
                          <div className="session-device-cell">
                            <span>{session.device_label}</span>
                            {session.current && <span className="session-current-badge">目前裝置</span>}
                          </div>
                        </td>
                        <td>{session.browser}</td>
                        <td>{session.ip_address || '-'}</td>
                        <td>{formatDate(session.last_seen_at || session.created_at)}</td>
                        <td>{formatDate(session.created_at)}</td>
                        <td>{formatDate(session.expires_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="session-btn danger"
                            onClick={() => handleRevokeSession(session)}
                            disabled={rowBusy || session.current}
                          >
                            下線
                          </button>
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
    </div>
  );
};
