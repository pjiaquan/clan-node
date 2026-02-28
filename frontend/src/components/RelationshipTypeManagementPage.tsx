import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, RelationshipTypeKey, RelationshipTypeLabel } from '../types';

type RelationshipTypeManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

type RowDraft = {
  label: string;
  description: string;
};

const TYPE_CODE_LABEL: Record<RelationshipTypeKey, string> = {
  parent_child: '親子',
  spouse: '夫妻',
  ex_spouse: '前配偶',
  sibling: '手足',
  in_law: '姻親',
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

const isDirty = (row: RelationshipTypeLabel, draft: RowDraft) => (
  row.label !== draft.label || row.description !== draft.description
);

export const RelationshipTypeManagementPage: React.FC<RelationshipTypeManagementPageProps> = ({
  currentUser,
  onBack,
  onLogout,
}) => {
  const [items, setItems] = useState<RelationshipTypeLabel[]>([]);
  const [drafts, setDrafts] = useState<Record<RelationshipTypeKey, RowDraft>>({} as Record<RelationshipTypeKey, RowDraft>);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [busyType, setBusyType] = useState<RelationshipTypeKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const hydrateDrafts = useCallback((rows: RelationshipTypeLabel[]) => {
    const next = {} as Record<RelationshipTypeKey, RowDraft>;
    for (const row of rows) {
      next[row.type] = { label: row.label, description: row.description };
    }
    setDrafts(next);
  }, []);

  const loadItems = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const rows = await api.fetchRelationshipTypeLabels();
      setItems(rows);
      hydrateDrafts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入關係名稱失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateDrafts]);

  useEffect(() => {
    void loadItems(false);
  }, [loadItems]);

  const saveRow = useCallback(async (type: RelationshipTypeKey, payload: RowDraft) => {
    const nextLabel = payload.label.trim();
    const nextDescription = payload.description.trim();
    if (!nextLabel) {
      throw new Error('名稱不可為空白');
    }
    const updated = await api.updateRelationshipTypeLabel(type, {
      label: nextLabel,
      description: nextDescription,
    });
    setItems((prev) => prev.map((row) => (row.type === updated.type ? updated : row)));
    setDrafts((prev) => ({
      ...prev,
      [updated.type]: {
        label: updated.label,
        description: updated.description,
      }
    }));
  }, []);

  const handleSaveOne = useCallback(async (row: RelationshipTypeLabel) => {
    const draft = drafts[row.type];
    if (!draft || !isDirty(row, draft)) return;
    setBusyType(row.type);
    setError(null);
    try {
      await saveRow(row.type, draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
    } finally {
      setBusyType(null);
    }
  }, [drafts, saveRow]);

  const handleSaveAll = useCallback(async () => {
    const dirtyRows = items.filter((row) => {
      const draft = drafts[row.type];
      return draft ? isDirty(row, draft) : false;
    });
    if (!dirtyRows.length) return;

    setSavingAll(true);
    setError(null);
    try {
      for (const row of dirtyRows) {
        const draft = drafts[row.type];
        if (!draft) continue;
        await saveRow(row.type, draft);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '批次儲存失敗');
    } finally {
      setSavingAll(false);
    }
  }, [drafts, items, saveRow]);

  const handleResetRow = useCallback(async (row: RelationshipTypeLabel) => {
    const confirmed = window.confirm(`確定將「${TYPE_CODE_LABEL[row.type]}」重設為預設名稱？`);
    if (!confirmed) return;
    setBusyType(row.type);
    setError(null);
    try {
      await saveRow(row.type, {
        label: row.default_label,
        description: row.default_description,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '重設失敗');
    } finally {
      setBusyType(null);
    }
  }, [saveRow]);

  const handleResetAll = useCallback(async () => {
    const confirmed = window.confirm('確定將全部關係名稱重設為預設值？');
    if (!confirmed) return;
    setSavingAll(true);
    setError(null);
    try {
      const result = await api.resetRelationshipTypeLabels();
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
      row.label !== row.default_label || row.description !== row.default_description
    )).length;
    const dirty = items.filter((row) => {
      const draft = drafts[row.type];
      return draft ? isDirty(row, draft) : false;
    }).length;
    return {
      total: items.length,
      customized,
      dirty,
    };
  }, [drafts, items]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((row) => {
      const draft = drafts[row.type] ?? { label: row.label, description: row.description };
      return row.type.toLowerCase().includes(keyword)
        || TYPE_CODE_LABEL[row.type].toLowerCase().includes(keyword)
        || draft.label.toLowerCase().includes(keyword)
        || draft.description.toLowerCase().includes(keyword);
    });
  }, [drafts, items, search]);

  return (
    <div className="notice-page relationship-name-page">
      <header className="notice-header relationship-name-header">
        <div className="notice-header-left">
          <button type="button" className="notice-btn ghost" onClick={onBack}>
            返回族譜
          </button>
          <div>
            <h1>親戚關係名稱管理</h1>
            <p>可調整關係名稱，立即套用到圖譜操作按鈕</p>
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
            <span>總關係類型</span>
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
              placeholder="搜尋代碼、名稱、描述"
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
            <div className="notice-loading">載入關係名稱中...</div>
          ) : (
            <div className="notice-table-wrap">
              <table className="notice-table relationship-name-table">
                <thead>
                  <tr>
                    <th>代碼</th>
                    <th>目前名稱</th>
                    <th>描述</th>
                    <th>預設</th>
                    <th>更新時間</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((row) => {
                    const draft = drafts[row.type] ?? { label: row.label, description: row.description };
                    const rowDirty = isDirty(row, draft);
                    const rowBusy = busyType === row.type || savingAll;
                    return (
                      <tr key={row.type}>
                        <td>
                          <div className="relationship-name-code">
                            <strong>{TYPE_CODE_LABEL[row.type]}</strong>
                            <span>{row.type}</span>
                          </div>
                        </td>
                        <td>
                          <input
                            className="relationship-name-input"
                            value={draft.label}
                            maxLength={24}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [row.type]: {
                                  ...(prev[row.type] ?? { label: row.label, description: row.description }),
                                  label: value,
                                }
                              }));
                            }}
                            disabled={rowBusy}
                          />
                        </td>
                        <td>
                          <input
                            className="relationship-name-input relationship-name-description"
                            value={draft.description}
                            maxLength={80}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((prev) => ({
                                ...prev,
                                [row.type]: {
                                  ...(prev[row.type] ?? { label: row.label, description: row.description }),
                                  description: value,
                                }
                              }));
                            }}
                            disabled={rowBusy}
                          />
                        </td>
                        <td>
                          <div className="relationship-name-default">
                            <strong>{row.default_label}</strong>
                            <span>{row.default_description}</span>
                          </div>
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
                      <td colSpan={6} className="notice-empty">沒有符合條件的關係名稱</td>
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
