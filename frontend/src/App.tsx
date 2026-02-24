import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { AuthUser } from './types';
import { LoginPage } from './components/LoginPage';
import { ClanGraph } from './ClanGraph';
import { UserManagementPage } from './components/UserManagementPage';
import { SessionManagementPage } from './components/SessionManagementPage';
import { NotificationManagementPage } from './components/NotificationManagementPage';
import './App.css';

type AppView = 'graph' | 'users' | 'sessions' | 'notifications';

const getViewFromHash = (): AppView => {
  if (window.location.hash === '#/users') return 'users';
  if (window.location.hash === '#/sessions') return 'sessions';
  if (window.location.hash === '#/notifications') return 'notifications';
  return 'graph';
};

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<AppView>(() => getViewFromHash());

  const navigateTo = useCallback((next: AppView) => {
    const nextHash = next === 'users'
      ? '#/users'
      : next === 'sessions'
        ? '#/sessions'
        : next === 'notifications'
          ? '#/notifications'
        : '#/graph';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    setView(next);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setView(getViewFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setIsAuthed(false);
      setAuthUser(null);
      setAuthError('登入已過期，請重新登入');
      navigateTo('graph');
    };
    window.addEventListener('clan:unauthorized', onUnauthorized as EventListener);
    return () => window.removeEventListener('clan:unauthorized', onUnauthorized as EventListener);
  }, [navigateTo]);

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
    navigateTo('graph');
  }, [navigateTo]);

  useEffect(() => {
    if (!isAuthed) return;
    if ((view === 'users' || view === 'notifications') && authUser?.role !== 'admin') {
      navigateTo('graph');
    }
  }, [view, authUser, isAuthed, navigateTo]);

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    const verify = async () => {
      try {
        const data = await api.authMe();
        if (cancelled) return;
        setAuthUser(data.user);
      } catch {
        if (cancelled) return;
        setIsAuthed(false);
        setAuthUser(null);
        setAuthError('登入已過期，請重新登入');
        navigateTo('graph');
      }
    };
    const timer = window.setInterval(verify, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthed, navigateTo]);

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
  if (!authUser) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>載入使用者資訊...</p>
        </div>
      </div>
    );
  }

  if (view === 'users' && authUser.role === 'admin') {
    return (
      <UserManagementPage
        currentUser={authUser}
        onBack={() => navigateTo('graph')}
        onLogout={handleLogout}
      />
    );
  }

  if (view === 'sessions') {
    return (
      <SessionManagementPage
        currentUser={authUser}
        onBack={() => navigateTo('graph')}
        onLogout={handleLogout}
      />
    );
  }

  if (view === 'notifications' && authUser.role === 'admin') {
    return (
      <NotificationManagementPage
        currentUser={authUser}
        onBack={() => navigateTo('graph')}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ClanGraph
      username={authUser.username || null}
      readOnly={authUser.role === 'readonly'}
      isAdmin={authUser.role === 'admin'}
      onManageUsers={authUser.role === 'admin' ? () => navigateTo('users') : undefined}
      onManageNotifications={authUser.role === 'admin' ? () => navigateTo('notifications') : undefined}
      onManageSessions={() => navigateTo('sessions')}
      onLogout={handleLogout}
    />
  );
}

export default App;
