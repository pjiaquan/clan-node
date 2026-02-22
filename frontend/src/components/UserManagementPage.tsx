import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AuthUser, ManagedUser, UserRole } from '../types';
import { CreateUserModal } from './CreateUserModal';

type UserManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

const formatDate = (value: string) => {
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

export const UserManagementPage: React.FC<UserManagementPageProps> = ({ currentUser, onBack, onLogout }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadUsers = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const data = await api.fetchUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入帳號失敗');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const handleCreateUser = useCallback(async (username: string, password: string, role: UserRole) => {
    await api.createUser(username, password, role);
    setShowCreateModal(false);
    await loadUsers(true);
  }, [loadUsers]);

  const handleRoleChange = useCallback(async (user: ManagedUser, role: UserRole) => {
    if (user.role === role) return;
    setBusyUserId(user.id);
    setError(null);
    try {
      const updated = await api.updateUser(user.id, { role });
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新角色失敗');
    } finally {
      setBusyUserId(null);
    }
  }, []);

  const handleDeleteUser = useCallback(async (user: ManagedUser) => {
    const confirmed = window.confirm(`確定刪除帳號「${user.username}」？`);
    if (!confirmed) return;
    setBusyUserId(user.id);
    setError(null);
    try {
      await api.deleteUser(user.id);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除帳號失敗');
    } finally {
      setBusyUserId(null);
    }
  }, []);

  return (
    <div className="user-admin-page">
      <header className="user-admin-header">
        <div className="user-admin-header-left">
          <button type="button" className="user-admin-btn ghost" onClick={onBack}>
            返回族譜
          </button>
          <div>
            <h1>帳號管理</h1>
            <p>管理系統使用者與權限</p>
          </div>
        </div>
        <div className="user-admin-header-right">
          <span className="user-admin-current-user">{currentUser.username}</span>
          <button type="button" className="user-admin-btn ghost" onClick={onLogout}>
            登出
          </button>
        </div>
      </header>

      <main className="user-admin-main">
        <section className="user-admin-stats">
          <article className="user-admin-stat-card">
            <span>總帳號</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="user-admin-stat-card">
            <span>管理員</span>
            <strong>{stats.admin}</strong>
          </article>
          <article className="user-admin-stat-card">
            <span>只讀帳號</span>
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
              {refreshing ? '更新中...' : '重新整理'}
            </button>
            <button
              type="button"
              className="user-admin-btn primary"
              onClick={() => setShowCreateModal(true)}
            >
              新增帳號
            </button>
          </div>

          {error && <div className="user-admin-error">{error}</div>}

          {loading ? (
            <div className="user-admin-loading">載入帳號中...</div>
          ) : (
            <div className="user-admin-table-wrap">
              <table className="user-admin-table">
                <thead>
                  <tr>
                    <th>帳號</th>
                    <th>角色</th>
                    <th>建立時間</th>
                    <th>更新時間</th>
                    <th>操作</th>
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
                            <span>{user.username}</span>
                            {isSelf && <span className="user-admin-self-badge">目前登入</span>}
                          </div>
                        </td>
                        <td>
                          <select
                            className="user-admin-role-select"
                            value={user.role}
                            onChange={(event) => handleRoleChange(user, event.target.value === 'admin' ? 'admin' : 'readonly')}
                            disabled={rowBusy}
                          >
                            <option value="admin">管理員</option>
                            <option value="readonly">只讀</option>
                          </select>
                        </td>
                        <td>{formatDate(user.created_at)}</td>
                        <td>{formatDate(user.updated_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="user-admin-btn danger"
                            disabled={rowBusy || isSelf}
                            onClick={() => handleDeleteUser(user)}
                          >
                            刪除
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

      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateUser}
        />
      )}
    </div>
  );
};
