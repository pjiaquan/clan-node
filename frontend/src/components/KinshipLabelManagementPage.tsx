import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, KinshipLabel } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';

type KinshipLabelManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onManageSessions: () => void;
  onOpenSettings: () => void;
  onManageUsers: () => void;
  onManageNotifications: () => void;
  onManageAuditLogs: () => void;
  onLogout: () => Promise<void> | void;
};

type RowDraft = {
  custom_title: string;
  custom_formal_title: string;
  description: string;
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

const isDirty = (row: KinshipLabel, draft: RowDraft) => (
  (row.custom_title ?? '') !== draft.custom_title
  || (row.custom_formal_title ?? '') !== draft.custom_formal_title
  || row.description !== draft.description
);

const currentTitleFrom = (row: KinshipLabel, draft: RowDraft) => (
  draft.custom_title.trim() || row.default_title
);

const currentFormalTitleFrom = (row: KinshipLabel, draft: RowDraft) => (
  draft.custom_formal_title.trim() || row.default_formal_title
);

export const KinshipLabelManagementPage: React.FC<KinshipLabelManagementPageProps> = ({
  currentUser,
  onBack,
  onManageSessions,
  onOpenSettings,
  onManageUsers,
  onManageNotifications,
  onManageAuditLogs,
  onLogout,
}) => {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<KinshipLabel[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const makeKey = useCallback((row: Pick<KinshipLabel, 'default_title' | 'default_formal_title'>) => (
    `${row.default_title}\u0001${row.default_formal_title}`
  ), []);

  const hydrateDrafts = useCallback((rows: KinshipLabel[]) => {
    const next: Record<string, RowDraft> = {};
    for (const row of rows) {
      next[makeKey(row)] = {
        custom_title: row.custom_title ?? '',
        custom_formal_title: row.custom_formal_title ?? '',
        description: row.description,
      };
    }
    setDrafts(next);
  }, [makeKey]);

  const loadItems = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const rows = await api.fetchKinshipLabels();
      setItems(rows);
      hydrateDrafts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kinship.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateDrafts, t]);

  useEffect(() => {
    void loadItems(false);
  }, [loadItems]);

  const saveRow = useCallback(async (row: KinshipLabel, draft: RowDraft) => {
    const updated = await api.updateKinshipLabel({
      default_title: row.default_title,
      default_formal_title: row.default_formal_title,
      custom_title: draft.custom_title.trim() || null,
      custom_formal_title: draft.custom_formal_title.trim() || null,
      description: draft.description.trim(),
    });
    const rowKey = makeKey(updated);
    setItems((prev) => prev.map((item) => (makeKey(item) === rowKey ? updated : item)));
    setDrafts((prev) => ({
      ...prev,
      [rowKey]: {
        custom_title: updated.custom_title ?? '',
        custom_formal_title: updated.custom_formal_title ?? '',
        description: updated.description,
      }
    }));
  }, [makeKey]);

  const handleSaveOne = useCallback(async (row: KinshipLabel) => {
    const rowKey = makeKey(row);
    const draft = drafts[rowKey];
    if (!draft || !isDirty(row, draft)) return;
    setBusyKey(rowKey);
    setError(null);
    try {
      await saveRow(row, draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kinship.saveFailed'));
    } finally {
      setBusyKey(null);
    }
  }, [drafts, makeKey, saveRow, t]);

  const handleSaveAll = useCallback(async () => {
    const dirtyRows = items.filter((row) => {
      const draft = drafts[makeKey(row)];
      return draft ? isDirty(row, draft) : false;
    });
    if (!dirtyRows.length) return;

    setSavingAll(true);
    setError(null);
    try {
      for (const row of dirtyRows) {
        const draft = drafts[makeKey(row)];
        if (!draft) continue;
        await saveRow(row, draft);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kinship.bulkSaveFailed'));
    } finally {
      setSavingAll(false);
    }
  }, [drafts, items, makeKey, saveRow, t]);

  const handleResetRow = useCallback(async (row: KinshipLabel) => {
    const confirmed = window.confirm(t('kinship.resetConfirm', { title: row.default_title }));
    if (!confirmed) return;
    const rowKey = makeKey(row);
    setBusyKey(rowKey);
    setError(null);
    try {
      await saveRow(row, {
        custom_title: '',
        custom_formal_title: '',
        description: row.description,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kinship.resetFailed'));
    } finally {
      setBusyKey(null);
    }
  }, [makeKey, saveRow, t]);

  const handleResetAll = useCallback(async () => {
    const confirmed = window.confirm(t('kinship.resetAllConfirm'));
    if (!confirmed) return;
    setSavingAll(true);
    setError(null);
    try {
      const result = await api.resetKinshipLabels();
      setItems(result.items);
      hydrateDrafts(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kinship.resetAllFailed'));
    } finally {
      setSavingAll(false);
    }
  }, [hydrateDrafts, t]);

  const stats = useMemo(() => {
    const customized = items.filter((row) => (
      row.custom_title || row.custom_formal_title
    )).length;
    const dirty = items.filter((row) => {
      const draft = drafts[makeKey(row)];
      return draft ? isDirty(row, draft) : false;
    }).length;
    return {
      total: items.length,
      customized,
      dirty,
    };
  }, [drafts, items, makeKey]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((row) => {
      const rowKey = makeKey(row);
      const draft = drafts[rowKey] ?? {
        custom_title: row.custom_title ?? '',
        custom_formal_title: row.custom_formal_title ?? '',
        description: row.description,
      };
      return row.default_title.toLowerCase().includes(keyword)
        || row.default_formal_title.toLowerCase().includes(keyword)
        || draft.custom_title.toLowerCase().includes(keyword)
        || draft.custom_formal_title.toLowerCase().includes(keyword)
        || draft.description.toLowerCase().includes(keyword);
    });
  }, [drafts, items, makeKey, search]);

  return (
    <div className="notice-page relationship-name-page">
      <header className="notice-header relationship-name-header">
        <div className="notice-header-left">
          <h1>
            <button type="button" className="header-title-button" onClick={onBack}>
              {t('kinship.title')}
            </button>
          </h1>
        </div>
        <div className="notice-header-right">
          <span className="notice-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            currentPage="kinshipLabels"
            isAdmin={currentUser.role === 'admin'}
            onBack={onBack}
            onManageSessions={onManageSessions}
            onOpenSettings={onOpenSettings}
            onManageUsers={onManageUsers}
            onManageNotifications={onManageNotifications}
            onManageAuditLogs={onManageAuditLogs}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="notice-main relationship-name-main">
        <section className="notice-stats">
          <article className="notice-stat-card">
            <span>{t('kinship.total')}</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="notice-stat-card">
            <span>{t('kinship.customized')}</span>
            <strong>{stats.customized}</strong>
          </article>
          <article className="notice-stat-card">
            <span>{t('kinship.unsaved')}</span>
            <strong>{stats.dirty}</strong>
          </article>
        </section>

        <section className="notice-panel">
          <div className="notice-toolbar relationship-name-toolbar">
            <input
              type="search"
              className="relationship-name-search"
              placeholder={t('kinship.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="notice-btn secondary"
              onClick={() => loadItems(true)}
              disabled={refreshing || savingAll}
            >
              {refreshing ? t('common.refreshing') : t('common.refresh')}
            </button>
            <button
              type="button"
              className="notice-btn secondary"
              onClick={handleSaveAll}
              disabled={savingAll || stats.dirty === 0}
            >
              {savingAll ? t('kinship.saving') : t('kinship.saveAll', { count: stats.dirty })}
            </button>
            <button
              type="button"
              className="notice-btn danger"
              onClick={handleResetAll}
              disabled={savingAll}
            >
              {t('kinship.resetAll')}
            </button>
          </div>

          {error && <div className="notice-error">{error}</div>}

          {loading ? (
            <div className="notice-loading">{t('kinship.loading')}</div>
          ) : (
            <div className="notice-table-wrap">
              <table className="notice-table relationship-name-table">
                <thead>
                  <tr>
                    <th>{t('kinship.defaultTitle')}</th>
                    <th>{t('kinship.defaultFormalTitle')}</th>
                    <th>{t('kinship.currentTitle')}</th>
                    <th>{t('kinship.currentFormalTitle')}</th>
                    <th>{t('kinship.customTitle')}</th>
                    <th>{t('kinship.customFormalTitle')}</th>
                    <th>{t('kinship.description')}</th>
                    <th>{t('kinship.updatedAt')}</th>
                    <th>{t('kinship.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((row) => {
                    const rowKey = makeKey(row);
                    const draft = drafts[rowKey] ?? {
                      custom_title: row.custom_title ?? '',
                      custom_formal_title: row.custom_formal_title ?? '',
                      description: row.description,
                    };
                    const rowDirty = isDirty(row, draft);
                    const rowBusy = busyKey === rowKey || savingAll;
                    return (
                      <tr key={rowKey}>
                        <td>{row.default_title}</td>
                        <td>{row.default_formal_title}</td>
                        <td>{currentTitleFrom(row, draft)}</td>
                        <td>{currentFormalTitleFrom(row, draft)}</td>
                        <td>
                          <input
                            className="relationship-name-input"
                            value={draft.custom_title}
                            maxLength={24}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [rowKey]: {
                                  ...(prev[rowKey] ?? {
                                    custom_title: row.custom_title ?? '',
                                    custom_formal_title: row.custom_formal_title ?? '',
                                    description: row.description,
                                  }),
                                  custom_title: value,
                                }
                              }));
                            }}
                            disabled={rowBusy}
                            placeholder={t('kinship.emptyUsesDefault')}
                          />
                        </td>
                        <td>
                          <input
                            className="relationship-name-input"
                            value={draft.custom_formal_title}
                            maxLength={24}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [rowKey]: {
                                  ...(prev[rowKey] ?? {
                                    custom_title: row.custom_title ?? '',
                                    custom_formal_title: row.custom_formal_title ?? '',
                                    description: row.description,
                                  }),
                                  custom_formal_title: value,
                                }
                              }));
                            }}
                            disabled={rowBusy}
                            placeholder={t('kinship.emptyUsesDefault')}
                          />
                        </td>
                        <td>
                          <input
                            className="relationship-name-input relationship-name-description"
                            value={draft.description}
                            maxLength={120}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [rowKey]: {
                                  ...(prev[rowKey] ?? {
                                    custom_title: row.custom_title ?? '',
                                    custom_formal_title: row.custom_formal_title ?? '',
                                    description: row.description,
                                  }),
                                  description: value,
                                }
                              }));
                            }}
                            disabled={rowBusy}
                          />
                        </td>
                        <td>{formatDate(row.updated_at, locale)}</td>
                        <td>
                          <div className="relationship-name-actions">
                            <button
                              type="button"
                              className="notice-btn secondary"
                              disabled={!rowDirty || rowBusy}
                              onClick={() => handleSaveOne(row)}
                            >
                              {t('common.save')}
                            </button>
                            <button
                              type="button"
                              className="notice-btn danger"
                              disabled={rowBusy}
                              onClick={() => handleResetRow(row)}
                            >
                              {t('kinship.resetOne')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="notice-empty">{t('kinship.noMatch')}</td>
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
