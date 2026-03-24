import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { AuthUser, PendingMfaChallenge } from './types';
import { AcceptInvitePage } from './components/AcceptInvitePage';
import { AccountPage } from './components/AccountPage';
import { ForgotPasswordPage } from './components/ForgotPasswordPage';
import { LoginPage } from './components/LoginPage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { SetupPage } from './components/SetupPage';
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
import { useI18n } from './i18n';
import './App.css';

type AppView = 'graph' | 'account' | 'users' | 'sessions' | 'notifications' | 'auditLogs' | 'kinshipLabels' | 'settings';
type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'clan.theme.mode';

const getViewFromHash = (): AppView => {
  if (window.location.hash === '#/account') return 'account';
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

const hasStoredViewportState = () => {
  try {
    return Boolean(
      localStorage.getItem('clan.viewport')
      || localStorage.getItem('clan.pendingViewport')
      || localStorage.getItem('clan.pendingFocus')
      || localStorage.getItem('clan.pendingFocusPosition')
    );
  } catch (error) {
    console.warn('Failed to inspect stored viewport state:', error);
    return false;
  }
};

function App() {
  const { isZh, toggleLanguage, t } = useI18n();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [pendingMfa, setPendingMfa] = useState<PendingMfaChallenge | null>(null);
  const [pendingMfaMethod, setPendingMfaMethod] = useState<'totp' | 'email'>('email');
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URL(window.location.href).searchParams.get('invite_token');
  });
  const [resetPasswordToken, setResetPasswordToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URL(window.location.href).searchParams.get('reset_password_token');
  });
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [view, setView] = useState<AppView>(() => getViewFromHash());
  const [graphSettings, setGraphSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialTheme());
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 640px)').matches
      : false
  ));

  const navigateTo = useCallback((next: AppView) => {
    const nextHash = next === 'account'
      ? '#/account'
      : next === 'users'
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

  const clearUrlQueryParam = useCallback((name: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setIsAuthed(false);
      setAuthUser(null);
      setPendingMfa(null);
      setPendingMfaMethod('email');
      setAuthError(t('app.authExpired'));
      setAuthNotice(null);
      navigateTo('graph');
    };
    window.addEventListener('clan:unauthorized', onUnauthorized as EventListener);
    return () => window.removeEventListener('clan:unauthorized', onUnauthorized as EventListener);
  }, [isZh, navigateTo]);

  useEffect(() => {
    let cancelled = false;
    const verifyFromUrl = async () => {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('verify_email_token');
      if (!token) return;
      try {
        await api.verifyEmail(token);
        if (!cancelled) {
          setAuthNotice(t('app.emailVerified'));
          setAuthError(null);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('app.emailVerifyFailed');
          setAuthError(message);
        }
      } finally {
        url.searchParams.delete('verify_email_token');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    };
    verifyFromUrl();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleAcceptInvite = useCallback(async (password: string) => {
    if (!inviteToken) return;
    setAuthError(null);
    setAuthNotice(null);
    try {
      const result = await api.acceptInvite(inviteToken, password);
      clearUrlQueryParam('invite_token');
      setInviteToken(null);
      setAuthNotice(t('invite.acceptedNotice', { email: result.email }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('invite.failed');
      setAuthError(message);
    }
  }, [clearUrlQueryParam, inviteToken, t]);

  const handleCancelInvite = useCallback(() => {
    clearUrlQueryParam('invite_token');
    setInviteToken(null);
    setAuthError(null);
    setAuthNotice(null);
  }, [clearUrlQueryParam]);

  const handleForgotPassword = useCallback(async (email: string) => {
    setAuthError(null);
    setAuthNotice(null);
    try {
      await api.forgotPassword(email);
      setAuthNotice(t('forgotPassword.sent'));
      setShowForgotPassword(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('forgotPassword.failed');
      setAuthError(message);
    }
  }, [t]);

  const handleCancelForgotPassword = useCallback(() => {
    setShowForgotPassword(false);
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  const handleResetPassword = useCallback(async (password: string) => {
    if (!resetPasswordToken) return;
    setAuthError(null);
    setAuthNotice(null);
    try {
      await api.resetPassword(resetPasswordToken, password);
      clearUrlQueryParam('reset_password_token');
      setResetPasswordToken(null);
      setAuthNotice(t('resetPassword.success'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('resetPassword.failed');
      setAuthError(message);
    }
  }, [clearUrlQueryParam, resetPasswordToken, t]);

  const handleCancelResetPassword = useCallback(() => {
    clearUrlQueryParam('reset_password_token');
    setResetPasswordToken(null);
    setAuthError(null);
    setAuthNotice(null);
  }, [clearUrlQueryParam]);

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      try {
        const setupStatus = await api.getSetupStatus();
        if (!cancelled) {
          setRequiresSetup(Boolean(setupStatus.requires_setup));
        }
        if (setupStatus.requires_setup) {
          if (!cancelled) {
            setIsAuthed(false);
            setAuthUser(null);
            setPendingMfa(null);
            setPendingMfaMethod('email');
          }
          return;
        }
        const data = await api.authMe();
        if (cancelled) return;
        setIsAuthed(true);
        setAuthUser(data.user);
        setPendingMfa(null);
        setPendingMfaMethod('email');
        try {
          const hasFocused = sessionStorage.getItem('clan.focusedOnLogin');
          const storedCenter = localStorage.getItem('clan.centerId');
          if (storedCenter && !hasFocused && !hasStoredViewportState()) {
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
          setPendingMfa(null);
          setPendingMfaMethod('email');
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

  const handleLogin = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    try {
      const data = await api.login(email, password);
      if ('mfa_required' in data && data.mfa_required) {
        setPendingMfa(data);
        setPendingMfaMethod(data.preferred_method);
        if (data.preferred_method === 'email') {
          const debugSuffix = data.debug_mfa_code ? ` (${data.debug_mfa_code})` : '';
          setAuthNotice(`${t('login.mfaCodeSent', { email: data.masked_email })}${debugSuffix}`);
        } else {
          setAuthNotice(null);
        }
        setIsAuthed(false);
        setAuthUser(null);
        return;
      }
      setIsAuthed(true);
      setAuthUser(data.user);
      setPendingMfa(null);
      setPendingMfaMethod('email');
      try {
        const hasFocused = sessionStorage.getItem('clan.focusedOnLogin');
        const storedCenter = localStorage.getItem('clan.centerId');
        if (storedCenter && !hasFocused && !hasStoredViewportState()) {
          localStorage.setItem('clan.pendingFocus', JSON.stringify({ id: storedCenter, zoom: 1 }));
          sessionStorage.setItem('clan.focusedOnLogin', '1');
        }
      } catch (error) {
        console.warn('Failed to persist pending focus:', error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('app.signInFailed');
      setAuthError(message);
      setIsAuthed(false);
      setAuthUser(null);
      setPendingMfa(null);
      setPendingMfaMethod('email');
    }
  }, [t]);

  const handleVerifyMfa = useCallback(async (code: string) => {
    if (!pendingMfa) return;
    setAuthError(null);
    try {
      if (pendingMfaMethod === 'email' && !pendingMfa.email_challenge_id) {
        throw new Error(t('login.mfaCodeMissing'));
      }
      const data = pendingMfaMethod === 'totp'
        ? await api.verifyTotpMfa(pendingMfa.session_id, code)
        : await api.verifyMfa(pendingMfa.email_challenge_id || '', code);
      setIsAuthed(true);
      setAuthUser(data.user);
      setPendingMfa(null);
      setPendingMfaMethod('email');
      setAuthNotice(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('login.mfaVerifyFailed');
      setAuthError(message);
      setIsAuthed(false);
      setAuthUser(null);
    }
  }, [pendingMfa, pendingMfaMethod, t]);

  const handleUseEmailMfa = useCallback(async () => {
    if (!pendingMfa) return;
    setAuthError(null);
    try {
      const result = await api.sendEmailMfaCode(pendingMfa.session_id);
      setPendingMfa((prev) => prev ? {
        ...prev,
        email_challenge_id: result.challenge_id,
        delivered: result.delivered,
        preferred_method: 'email',
        debug_mfa_code: result.debug_mfa_code
      } : prev);
      setPendingMfaMethod('email');
      const debugSuffix = result.debug_mfa_code ? ` (${result.debug_mfa_code})` : '';
      setAuthNotice(`${t('login.mfaCodeSent', { email: pendingMfa.masked_email })}${debugSuffix}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('login.mfaVerifyFailed');
      setAuthError(message);
    }
  }, [pendingMfa, t]);

  const handleUseTotpMfa = useCallback(() => {
    setPendingMfaMethod('totp');
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  const handleCancelMfa = useCallback(() => {
    setPendingMfa(null);
    setPendingMfaMethod('email');
    setAuthError(null);
    setAuthNotice(null);
  }, []);

  useEffect(() => {
    if (!pendingMfa) return;
    setPendingMfaMethod(pendingMfa.preferred_method);
  }, [pendingMfa?.session_id, pendingMfa?.preferred_method]);

  const handleSetupAdmin = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    try {
      await api.setupAdmin(email, password);
      setRequiresSetup(false);
      setPendingMfa(null);
      setPendingMfaMethod('email');
      await handleLogin(email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('setup.failed');
      setAuthError(message);
    }
  }, [handleLogin, t]);

  const handleResendVerification = useCallback(async (email: string) => {
    setResendingVerification(true);
    setAuthError(null);
    try {
      const result = await api.resendVerification(email);
      const debugSuffix = result.debug_invite_token
        ? ` (${result.debug_invite_token})`
        : result.debug_verify_token
          ? ` (${result.debug_verify_token})`
          : '';
      setAuthNotice(`${t('login.verificationSent')}${debugSuffix}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('login.verificationFailed');
      setAuthError(message);
    } finally {
      setResendingVerification(false);
    }
  }, [t]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setIsAuthed(false);
    setAuthUser(null);
    setPendingMfa(null);
    setPendingMfaMethod('email');
    navigateTo('graph');
  }, [navigateTo]);

  const handleSaveGraphSettings = useCallback((
    nextSettings: GraphSettings,
    options?: { navigate?: boolean },
  ) => {
    const saved = saveGraphSettings(nextSettings, authUser?.username ?? null);
    setGraphSettings(saved);
    if (options?.navigate ?? true) {
      navigateTo('graph');
    }
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
        setAuthError(t('app.authExpired'));
        navigateTo('graph');
      }
    };
    const timer = window.setInterval(verify, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAuthed, isZh, navigateTo]);

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
    () => (themeMode === 'light'
      ? t('app.switchToDark')
      : t('app.switchToLight')),
    [t, themeMode],
  );

  const pageContent = useMemo(() => {
    if (!authChecked) {
      return (
        <div className="app">
          <div className="loading">
            <div className="spinner"></div>
            <p>{t('app.verifying')}</p>
          </div>
        </div>
      );
    }

    if (!isAuthed) {
      if (requiresSetup) {
        return <SetupPage error={authError} onSetup={handleSetupAdmin} />;
      }
      if (inviteToken) {
        return (
          <AcceptInvitePage
            error={authError}
            onSubmit={handleAcceptInvite}
            onCancel={handleCancelInvite}
          />
        );
      }
      if (resetPasswordToken) {
        return (
          <ResetPasswordPage
            error={authError}
            notice={authNotice}
            onSubmit={handleResetPassword}
            onCancel={handleCancelResetPassword}
          />
        );
      }
      if (showForgotPassword) {
        return (
          <ForgotPasswordPage
            error={authError}
            notice={authNotice}
            onSubmit={handleForgotPassword}
            onCancel={handleCancelForgotPassword}
          />
        );
      }
      return (
        <LoginPage
          error={authError}
          notice={authNotice}
          onLogin={handleLogin}
          onVerifyMfa={handleVerifyMfa}
          onUseEmailMfa={handleUseEmailMfa}
          onUseTotpMfa={handleUseTotpMfa}
          onCancelMfa={handleCancelMfa}
          pendingMfa={pendingMfa}
          pendingMfaMethod={pendingMfaMethod}
          onResendVerification={handleResendVerification}
          resendBusy={resendingVerification}
          onForgotPassword={() => {
            setShowForgotPassword(true);
            setAuthError(null);
            setAuthNotice(null);
          }}
        />
      );
    }

    if (!authUser) {
      return (
        <div className="app">
          <div className="loading">
            <div className="spinner"></div>
            <p>{t('app.loadingProfile')}</p>
          </div>
        </div>
      );
    }

    if (view === 'account') {
      return (
        <AccountPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onManageSessions={() => navigateTo('sessions')}
          onOpenSettings={() => navigateTo('settings')}
          onManageUsers={authUser.role === 'admin' ? () => navigateTo('users') : undefined}
          onManageNotifications={authUser.role === 'admin' ? () => navigateTo('notifications') : undefined}
          onManageAuditLogs={authUser.role === 'admin' ? () => navigateTo('auditLogs') : undefined}
          onManageRelationshipNames={authUser.role === 'admin' ? () => navigateTo('kinshipLabels') : undefined}
          onLogout={handleLogout}
          onAccountUpdated={setAuthUser}
        />
      );
    }

    if (view === 'users' && authUser.role === 'admin') {
      return (
        <UserManagementPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onManageSessions={() => navigateTo('sessions')}
          onOpenAccount={() => navigateTo('account')}
          onOpenSettings={() => navigateTo('settings')}
          onManageNotifications={() => navigateTo('notifications')}
          onManageAuditLogs={() => navigateTo('auditLogs')}
          onManageRelationshipNames={() => navigateTo('kinshipLabels')}
          onLogout={handleLogout}
        />
      );
    }

    if (view === 'sessions') {
      return (
        <SessionManagementPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onOpenAccount={() => navigateTo('account')}
          onOpenSettings={() => navigateTo('settings')}
          onManageUsers={authUser.role === 'admin' ? () => navigateTo('users') : undefined}
          onManageNotifications={authUser.role === 'admin' ? () => navigateTo('notifications') : undefined}
          onManageAuditLogs={authUser.role === 'admin' ? () => navigateTo('auditLogs') : undefined}
          onManageRelationshipNames={authUser.role === 'admin' ? () => navigateTo('kinshipLabels') : undefined}
          onLogout={handleLogout}
        />
      );
    }

    if (view === 'notifications' && authUser.role === 'admin') {
      return (
        <NotificationManagementPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onManageSessions={() => navigateTo('sessions')}
          onOpenAccount={() => navigateTo('account')}
          onOpenSettings={() => navigateTo('settings')}
          onManageUsers={() => navigateTo('users')}
          onManageAuditLogs={() => navigateTo('auditLogs')}
          onManageRelationshipNames={() => navigateTo('kinshipLabels')}
          onLogout={handleLogout}
        />
      );
    }

    if (view === 'auditLogs' && authUser.role === 'admin') {
      return (
        <AuditLogPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onManageSessions={() => navigateTo('sessions')}
          onOpenAccount={() => navigateTo('account')}
          onOpenSettings={() => navigateTo('settings')}
          onManageUsers={() => navigateTo('users')}
          onManageNotifications={() => navigateTo('notifications')}
          onManageRelationshipNames={() => navigateTo('kinshipLabels')}
          onLogout={handleLogout}
        />
      );
    }

    if (view === 'kinshipLabels' && authUser.role === 'admin') {
      return (
        <KinshipLabelManagementPage
          currentUser={authUser}
          onBack={() => navigateTo('graph')}
          onManageSessions={() => navigateTo('sessions')}
          onOpenAccount={() => navigateTo('account')}
          onOpenSettings={() => navigateTo('settings')}
          onManageUsers={() => navigateTo('users')}
          onManageNotifications={() => navigateTo('notifications')}
          onManageAuditLogs={() => navigateTo('auditLogs')}
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
          onManageSessions={() => navigateTo('sessions')}
          onOpenAccount={() => navigateTo('account')}
          onManageUsers={authUser.role === 'admin' ? () => navigateTo('users') : undefined}
          onManageNotifications={authUser.role === 'admin' ? () => navigateTo('notifications') : undefined}
          onManageAuditLogs={authUser.role === 'admin' ? () => navigateTo('auditLogs') : undefined}
          onManageRelationshipNames={authUser.role === 'admin' ? () => navigateTo('kinshipLabels') : undefined}
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
        onOpenAccount={() => navigateTo('account')}
        onOpenSettings={() => navigateTo('settings')}
        onLogout={handleLogout}
      />
    );
  }, [
    authChecked,
    isAuthed,
    authError,
    authNotice,
    authUser,
    pendingMfa,
    pendingMfaMethod,
    inviteToken,
    resetPasswordToken,
    requiresSetup,
    showForgotPassword,
    view,
    graphSettings,
    handleAcceptInvite,
    handleCancelInvite,
    handleCancelForgotPassword,
    handleCancelResetPassword,
    handleForgotPassword,
    handleLogin,
    handleLogout,
    handleResetPassword,
    handleVerifyMfa,
    handleUseEmailMfa,
    handleUseTotpMfa,
    handleCancelMfa,
    handleResendVerification,
    handleSetupAdmin,
    handleSaveGraphSettings,
    navigateTo,
    themeMode,
    toggleTheme,
    isZh,
    resendingVerification,
  ]);

  const hideFloatingThemeToggle = isMobileViewport;
  const hideFloatingLanguageToggle = isMobileViewport;
  const languageToggleLabel = isZh ? t('app.switchToEnglish') : t('app.switchToChinese');

  return (
    <>
      {!hideFloatingLanguageToggle && (
        <button
          type="button"
          className="theme-toggle"
          style={{ right: hideFloatingThemeToggle ? '0.75rem' : '6.7rem' }}
          onClick={toggleLanguage}
          aria-label={languageToggleLabel}
          title={languageToggleLabel}
        >
          {isZh ? t('app.langButtonEn') : t('app.langButtonZh')}
        </button>
      )}
      {!hideFloatingThemeToggle && (
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={themeToggleLabel}
          title={themeToggleLabel}
        >
          {themeMode === 'light' ? t('app.dark') : t('app.light')}
        </button>
      )}
      {pageContent}
    </>
  );
}

export default App;
