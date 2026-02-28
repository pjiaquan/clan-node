import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { AuthUser } from './types';
import { LoginPage } from './components/LoginPage';
import { ClanGraph } from './ClanGraph';
import { UserManagementPage } from './components/UserManagementPage';
import { SessionManagementPage } from './components/SessionManagementPage';
import { NotificationManagementPage } from './components/NotificationManagementPage';
import { AuditLogPage } from './components/AuditLogPage';
import { GraphSettingsPage } from './components/GraphSettingsPage';
import { KinshipLabelManagementPage } from './components/KinshipLabelManagementPage';
import {
  DEFAULT_GRAPH_SETTINGS,
  loadGraphSettings,
  saveGraphSettings,
  type GraphSettings,
} from './graphSettings';
import './App.css';

type AppView = 'graph' | 'users' | 'sessions' | 'notifications' | 'auditLogs' | 'kinshipLabels' | 'settings';
type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'clan.theme.mode';

const getViewFromHash = (): AppView => {
  if (window.location.hash === '#/users') return 'users';
  if (window.location.hash === '#/sessions') return 'sessions';
  if (window.location.hash === '#/notifications') return 'notifications';
  if (window.location.hash === '#/audit-logs') return 'auditLogs';
  if (window.location.hash === '#/kinship-labels' || window.location.hash === '#/relationship-names') return 'kinshipLabels';
  if (window.location.hash === '#/settings') return 'settings';
  return 'graph';
};

const getInitialTheme = (): ThemeMode => {
  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }
  } catch (error) {
    console.warn('Failed to load theme from localStorage:', error);
  }

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<AppView>(() => getViewFromHash());
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialTheme());
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 640px)').matches
      : false
  ));

  const navigateTo = useCallback((next: AppView) => {
    const nextHash = next === 'users'
      ? '#/users'
      : next === 'sessions'
        ? '#/sessions'
        : next === 'notifications'
          ? '#/notifications'
          : next === 'auditLogs'
            ? '#/audit-logs'
            : next === 'kinshipLabels'
              ? '#/kinship-labels'
            : next === 'settings'
              ? '#/settings'
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

  const handleSaveGraphSettings = useCallback((nextSettings: GraphSettings) => {
    const saved = saveGraphSettings(nextSettings, authUser?.username ?? null);
    setGraphSettings(saved);
    navigateTo('graph');
  }, [authUser, navigateTo]);

  useEffect(() => {
    if (!isAuthed) return;
    if ((view === 'users' || view === 'notifications' || view === 'auditLogs' || view === 'kinshipLabels') && authUser?.role !== 'admin') {
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

  useEffect(() => {
    if (!isAuthed || !authUser) return;
    setGraphSettings(loadGraphSettings(authUser.username || null));
  }, [isAuthed, authUser?.username]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeMode;
    root.style.colorScheme = themeMode;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (error) {
      console.warn('Failed to save theme to localStorage:', error);
    }
  }, [themeMode]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };
    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const themeToggleLabel = useMemo(
    () => (themeMode === 'light' ? '切換深色' : '切換淺色'),
    [themeMode],
  );

  const pageContent = useMemo(() => {
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

    if (view === 'auditLogs' && authUser.role === 'admin') {
      return (
        <AuditLogPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onLogout={handleLogout}
        />
      );
    }

    if (view === 'kinshipLabels' && authUser.role === 'admin') {
      return (
        <KinshipLabelManagementPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onLogout={handleLogout}
        />
      );
    }

    if (view === 'settings') {
      return (
        <GraphSettingsPage
          currentUser={authUser}
          settings={graphSettings}
          onSave={handleSaveGraphSettings}
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
        themeMode={themeMode}
        onToggleTheme={toggleTheme}
        graphSettings={graphSettings}
        onManageUsers={authUser.role === 'admin' ? () => navigateTo('users') : undefined}
        onManageNotifications={authUser.role === 'admin' ? () => navigateTo('notifications') : undefined}
        onManageAuditLogs={authUser.role === 'admin' ? () => navigateTo('auditLogs') : undefined}
        onManageRelationshipNames={authUser.role === 'admin' ? () => navigateTo('kinshipLabels') : undefined}
        onManageSessions={() => navigateTo('sessions')}
        onOpenSettings={() => navigateTo('settings')}
        onLogout={handleLogout}
      />
    );
  }, [
    authChecked,
    isAuthed,
    authError,
    authUser,
    view,
    graphSettings,
    handleLogin,
    handleLogout,
    handleSaveGraphSettings,
    navigateTo,
    themeMode,
    toggleTheme,
  ]);

  const hideFloatingThemeToggle = isAuthed && view === 'graph' && isMobileViewport;

  return (
    <>
      {!hideFloatingThemeToggle && (
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={themeToggleLabel}
          title={themeToggleLabel}
        >
          {themeMode === 'light' ? 'Dark' : 'Light'}
        </button>
      )}
      {pageContent}
    </>
  );
}

export default App;
