import React, { useState } from 'react';

interface CreateUserModalProps {
  onClose: () => void;
  onSubmit: (username: string, password: string, role: 'admin' | 'readonly') => Promise<void>;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({ onClose, onSubmit }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'readonly'>('readonly');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('請輸入帳號與密碼');
      return;
    }

    setIsSaving(true);
    try {
      await onSubmit(username.trim(), password, role);
    } catch (err) {
      const message = err instanceof Error ? err.message : '建立帳號失敗';
      setError(message);
      return;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>新增帳號</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="new-username">帳號</label>
            <input
              id="new-username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="輸入帳號"
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-password">密碼</label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="輸入密碼"
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-role">角色</label>
            <select
              id="new-role"
              value={role}
              onChange={(event) => setRole(event.target.value === 'admin' ? 'admin' : 'readonly')}
            >
              <option value="readonly">只讀</option>
              <option value="admin">管理員</option>
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? '建立中...' : '建立帳號'}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
};
