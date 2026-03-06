import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuditLogItem, AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';

type AuditLogPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onManageSessions: () => void;
  onOpenSettings: () => void;
  onManageUsers: () => void;
  onManageNotifications: () => void;
  onManageRelationshipNames: () => void;
  onLogout: () => Promise<void> | void;
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

const serializeDetails = (details: AuditLogItem['details']) => {
  if (!details) return '-';
  try {
    return JSON.stringify(details);
  } catch {
    return '-';
  }
};

export const AuditLogPage: React.FC<AuditLogPageProps> = ({
  currentUser,
  onBack,
  onManageSessions,
  onOpenSettings,
  onManageUsers,
  onManageNotifications,
  onManageRelationshipNames,
  onLogout,
}) => {
  const { t, locale } = useI18n();
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
      setError(err instanceof Error ? err.message : t('audit.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [limit, t]);

  const prettyAction = useCallback((value: string) => {
    const mapped = t(`audit.action.${value}`);
    return mapped === `audit.action.${value}` ? value : mapped;
  }, [t]);

  const prettyResource = useCallback((value: string) => {
    const mapped = t(`audit.resource.${value}`);
    return mapped === `audit.resource.${value}` ? value : mapped;
  }, [t]);

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
          <h1>
            <button type="button" className="header-title-button" onClick={onBack}>
              {t('audit.title')}
            </button>
          </h1>
        </div>
        <div className="notice-header-right">
          <span className="notice-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            currentPage="auditLogs"
            isAdmin={currentUser.role === 'admin'}
            onBack={onBack}
            onManageSessions={onManageSessions}
            onOpenSettings={onOpenSettings}
            onManageUsers={onManageUsers}
            onManageNotifications={onManageNotifications}
            onManageRelationshipNames={onManageRelationshipNames}
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
              <option value="all">{t('audit.allActions')}</option>
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
              <option value="all">{t('audit.allResources')}</option>
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
              <option value="100">{t('audit.last100')}</option>
              <option value="200">{t('audit.last200')}</option>
              <option value="500">{t('audit.last500')}</option>
            </select>
            <input
              type="search"
              className="notice-filter-select audit-log-search-input"
              placeholder={t('audit.searchPlaceholder')}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <button
              type="button"
              className="notice-btn secondary"
              onClick={() => loadLogs(true)}
              disabled={refreshing}
            >
              {refreshing ? t('common.refreshing') : t('common.refresh')}
            </button>
          </div>

          {error && <div className="notice-error">{error}</div>}

          {loading ? (
            <div className="notice-loading">{t('audit.loading')}</div>
          ) : (
            <div className="notice-table-wrap audit-log-table-wrap">
              <table className="notice-table">
                <thead>
                  <tr>
                    <th>{t('audit.time')}</th>
                    <th>{t('audit.actor')}</th>
                    <th>{t('audit.action')}</th>
                    <th>{t('audit.resource')}</th>
                    <th>{t('audit.resourceId')}</th>
                    <th>{t('audit.summary')}</th>
                    <th>{t('audit.details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => {
                    const details = serializeDetails(log.details);
                    return (
                      <tr key={log.id}>
                        <td>{formatDate(log.created_at, locale)}</td>
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
                      <td colSpan={7} className="notice-empty">{t('audit.noMatch')}</td>
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
