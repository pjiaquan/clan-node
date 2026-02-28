import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, KinshipLabel } from '../types';

type KinshipLabelManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

type RowDraft = {
  custom_title: string;
  custom_formal_title: string;
  description: string;
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
  onLogout,
}) => {
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
      setError(err instanceof Error ? err.message : '載入稱呼表失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateDrafts]);

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
      setError(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setBusyKey(null);
    }
  }, [drafts, makeKey, saveRow]);

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
      setError(err instanceof Error ? err.message : '批次儲存失敗');
    } finally {
      setSavingAll(false);
    }
  }, [drafts, items, makeKey, saveRow]);

  const handleResetRow = useCallback(async (row: KinshipLabel) => {
    const confirmed = window.confirm(`確定重設「${row.default_title}」這筆稱呼？`);
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
      setError(err instanceof Error ? err.message : '重設失敗');
    } finally {
      setBusyKey(null);
    }
  }, [makeKey, saveRow]);

  const handleResetAll = useCallback(async () => {
    const confirmed = window.confirm('確定將全部稱呼重設為預設值？');
    if (!confirmed) return;
    setSavingAll(true);
    setError(null);
    try {
      const result = await api.resetKinshipLabels();
      setItems(result.items);
      hydrateDrafts(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重設全部失敗');
    } finally {
      setSavingAll(false);
    }
  }, [hydrateDrafts]);

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
          <button type="button" className="notice-btn ghost" onClick={onBack}>
            返回族譜
          </button>
          <div>
            <h1>稱呼管理表</h1>
            <p>可編輯節點稱呼（稱呼 / 正式稱呼），儲存後即套用</p>
          </div>
        </div>
        <div className="notice-header-right">
          <span className="notice-user-chip">{currentUser.username}</span>
          <button type="button" className="notice-btn ghost" onClick={onLogout}>
            登出
          </button>
        </div>
      </header>

      <main className="notice-main relationship-name-main">
        <section className="notice-stats">
          <article className="notice-stat-card">
            <span>總稱呼條目</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="notice-stat-card">
            <span>已自訂</span>
            <strong>{stats.customized}</strong>
          </article>
          <article className="notice-stat-card">
            <span>未儲存變更</span>
            <strong>{stats.dirty}</strong>
          </article>
        </section>

        <section className="notice-panel">
          <div className="notice-toolbar relationship-name-toolbar">
            <input
              type="search"
              className="relationship-name-search"
              placeholder="搜尋稱呼、正式稱呼或說明"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="notice-btn secondary"
              onClick={() => loadItems(true)}
              disabled={refreshing || savingAll}
            >
              {refreshing ? '更新中...' : '重新整理'}
            </button>
            <button
              type="button"
              className="notice-btn secondary"
              onClick={handleSaveAll}
              disabled={savingAll || stats.dirty === 0}
            >
              {savingAll ? '儲存中...' : `儲存全部 (${stats.dirty})`}
            </button>
            <button
              type="button"
              className="notice-btn danger"
              onClick={handleResetAll}
              disabled={savingAll}
            >
              重設全部
            </button>
          </div>

          {error && <div className="notice-error">{error}</div>}

          {loading ? (
            <div className="notice-loading">載入稱呼中...</div>
          ) : (
            <div className="notice-table-wrap">
              <table className="notice-table relationship-name-table">
                <thead>
                  <tr>
                    <th>預設稱呼</th>
                    <th>預設正式稱呼</th>
                    <th>目前稱呼</th>
                    <th>目前正式稱呼</th>
                    <th>自訂稱呼</th>
                    <th>自訂正式稱呼</th>
                    <th>說明</th>
                    <th>更新時間</th>
                    <th>操作</th>
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
                            placeholder="留白即使用預設"
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
                            placeholder="留白即使用預設"
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
                        <td>{formatDate(row.updated_at)}</td>
                        <td>
                          <div className="relationship-name-actions">
                            <button
                              type="button"
                              className="notice-btn secondary"
                              disabled={!rowDirty || rowBusy}
                              onClick={() => handleSaveOne(row)}
                            >
                              儲存
                            </button>
                            <button
                              type="button"
                              className="notice-btn danger"
                              disabled={rowBusy}
                              onClick={() => handleResetRow(row)}
                            >
                              重設
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="notice-empty">沒有符合條件的稱呼</td>
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
