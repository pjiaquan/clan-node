import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuditLogItem, AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';

type AuditLogPageProps = {
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

const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '刪除',
  setup: '初始化',
  status_change: '狀態變更',
  revoke: '撤銷',
  revoke_others: '全部撤銷',
  update_avatar: '修改頭像',
};

const RESOURCE_LABELS: Record<string, string> = {
  people: '人物',
  relationships: '關係',
  users: '帳號',
  notifications: '通知',
  sessions: 'Session',
};

const prettyAction = (value: string) => ACTION_LABELS[value] || value;
const prettyResource = (value: string) => RESOURCE_LABELS[value] || value;

const serializeDetails = (details: AuditLogItem['details']) => {
  if (!details) return '-';
  try {
    return JSON.stringify(details);
  } catch {
    return '-';
  }
};

export const AuditLogPage: React.FC<AuditLogPageProps> = ({ currentUser, onBack, onLogout }) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [keyword, setKeyword] = useState('');

  const loadLogs = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const data = await api.fetchAuditLogs(limit);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入修改記錄失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadLogs(false);
  }, [loadLogs]);

  const actionOptions = useMemo(() => {
    return [...new Set(logs.map((log) => log.action))].sort();
  }, [logs]);

  const resourceOptions = useMemo(() => {
    return [...new Set(logs.map((log) => log.resource_type))].sort();
  }, [logs]);

  const filteredLogs = useMemo(() => (
    logs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (resourceFilter !== 'all' && log.resource_type !== resourceFilter) return false;
      const query = keyword.trim().toLowerCase();
      if (!query) return true;
      const details = serializeDetails(log.details);
      const searchText = [
        log.actor_username || '',
        log.actor_role || '',
        prettyAction(log.action),
        prettyResource(log.resource_type),
        log.resource_id || '',
        log.summary || '',
        details,
        log.created_at || '',
      ].join(' ').toLowerCase();
      if (!searchText.includes(query)) return false;
      return true;
    })
  ), [logs, actionFilter, resourceFilter, keyword]);

  return (
    <div className="notice-page">
      <header className="notice-header">
        <div className="notice-header-left">
          <h1>修改記錄</h1>
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
        <section className="notice-panel">
          <div className="notice-toolbar">
            <select
              className="notice-filter-select"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
            >
              <option value="all">全部動作</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {prettyAction(action)}
                </option>
              ))}
            </select>
            <select
              className="notice-filter-select"
              value={resourceFilter}
              onChange={(event) => setResourceFilter(event.target.value)}
            >
              <option value="all">全部資源</option>
              {resourceOptions.map((resourceType) => (
                <option key={resourceType} value={resourceType}>
                  {prettyResource(resourceType)}
                </option>
              ))}
            </select>
            <select
              className="notice-filter-select"
              value={String(limit)}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              <option value="100">最近 100 筆</option>
              <option value="200">最近 200 筆</option>
              <option value="500">最近 500 筆</option>
            </select>
            <input
              type="search"
              className="notice-filter-select audit-log-search-input"
              placeholder="搜尋操作者、摘要、資源 ID、詳細內容"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <button
              type="button"
              className="notice-btn secondary"
              onClick={() => loadLogs(true)}
              disabled={refreshing}
            >
              {refreshing ? '更新中...' : '重新整理'}
            </button>
          </div>

          {error && <div className="notice-error">{error}</div>}

          {loading ? (
            <div className="notice-loading">載入修改記錄中...</div>
          ) : (
            <div className="notice-table-wrap audit-log-table-wrap">
              <table className="notice-table">
                <thead>
                  <tr>
                    <th>時間</th>
                    <th>操作者</th>
                    <th>動作</th>
                    <th>資源</th>
                    <th>資源 ID</th>
                    <th>摘要</th>
                    <th>詳細</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => {
                    const details = serializeDetails(log.details);
                    return (
                      <tr key={log.id}>
                        <td>{formatDate(log.created_at)}</td>
                        <td>{log.actor_username ? `${log.actor_username}${log.actor_role ? ` (${log.actor_role})` : ''}` : '-'}</td>
                        <td>{prettyAction(log.action)}</td>
                        <td>{prettyResource(log.resource_type)}</td>
                        <td>{log.resource_id || '-'}</td>
                        <td>{log.summary || '-'}</td>
                        <td>
                          <div className="notice-message" title={details}>
                            {details}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="notice-empty">沒有符合條件的修改記錄</td>
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
