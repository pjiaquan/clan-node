import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { AuthUser } from './types';
import { LoginPage } from './components/LoginPage';
import { ClanGraph } from './ClanGraph';
import './App.css';

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const data = await api.authMe();
        if (cancelled) return;
        setIsAuthed(true);
        setAuthUser(data.user);
        try {
          const hasFocused = sessionStorage.getItem('clan.focusedOnLogin');
          const storedCenter = localStorage.getItem('clan.centerId');
          if (storedCenter && !hasFocused) {
            localStorage.setItem('clan.pendingFocus', JSON.stringify({ id: storedCenter, zoom: 1 }));
            sessionStorage.setItem('clan.focusedOnLogin', '1');
          }
        } catch (error) {
          console.warn('Failed to persist pending focus:', error);
        }
      } catch (err) {
        if (!cancelled) {
          setIsAuthed(false);
          setAuthUser(null);
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = useCallback(async (username: string, password: string) => {
    setAuthError(null);
    try {
      const data = await api.login(username, password);
      setIsAuthed(true);
      setAuthUser(data.user);
      try {
        const hasFocused = sessionStorage.getItem('clan.focusedOnLogin');
        const storedCenter = localStorage.getItem('clan.centerId');
        if (storedCenter && !hasFocused) {
          localStorage.setItem('clan.pendingFocus', JSON.stringify({ id: storedCenter, zoom: 1 }));
          sessionStorage.setItem('clan.focusedOnLogin', '1');
        }
      } catch (error) {
        console.warn('Failed to persist pending focus:', error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '登入失敗';
      setAuthError(message);
      setIsAuthed(false);
      setAuthUser(null);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setIsAuthed(false);
    setAuthUser(null);
  }, []);
  if (!authChecked) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>驗證中...</p>
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return <LoginPage error={authError} onLogin={handleLogin} />;
  }

  return (
    <ClanGraph
      username={authUser?.username || null}
      readOnly={authUser?.role === 'readonly'}
      isAdmin={authUser?.role === 'admin'}
      onLogout={handleLogout}
    />
  );
}

export default App;
