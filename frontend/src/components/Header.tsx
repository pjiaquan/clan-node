import React, { useEffect, useMemo, useRef, useState } from 'react';
import { preloadNameSearchConverters } from '../utils/nameSearch';
import { createPersonSearchMatcher, type SearchablePerson } from '../utils/personSearch';
import type { RelationshipTypeKey } from '../types';
import { useI18n } from '../i18n';

type ActionIconName =
  | 'sessions'
  | 'settings'
  | 'clearDim'
  | 'expand'
  | 'showHidden'
  | 'screenshot'
  | 'undo'
  | 'addMember'
  | 'myLocation'
  | 'relationship'
  | 'center'
  | 'spouse'
  | 'exSpouse'
  | 'parentChild'
  | 'sibling'
  | 'inLaw'
  | 'reverse'
  | 'delete'
  | 'createAccount'
  | 'accounts'
  | 'notifications'
  | 'audit'
  | 'labels'
  | 'language'
  | 'themeLight'
  | 'themeDark'
  | 'logout';

const ActionIcon: React.FC<{ name: ActionIconName }> = ({ name }) => {
  switch (name) {
    case 'sessions':
      return (
        <svg viewBox="0 0 24 24">
          <rect x="3" y="5" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M7 19h4M18 9h3M18 13h3M18 17h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M4 7h7M15 7h5M9 7a2 2 0 1 0 4 0a2 2 0 0 0-4 0ZM4 17h3M11 17h9M7 17a2 2 0 1 0 4 0a2 2 0 0 0-4 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'clearDim':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M4 12s3-5 8-5s8 5 8 5s-3 5-8 5s-8-5-8-5Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M3 3l18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'expand':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 9l6-6M21 9l-6-6M3 15l6 6M21 15l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'showHidden':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M2.5 12s3.5-6 9.5-6s9.5 6 9.5 6s-3.5 6-9.5 6s-9.5-6-9.5-6Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.75" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'screenshot':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M8 6l1.5-2h5L16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3.25" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'undo':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M9 8H4V3M4 8l5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 8h8a6 6 0 1 1 0 12H8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'addMember':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5M18 8v6M15 11h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'myLocation':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'relationship':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M9 8.5a3.5 3.5 0 0 1 5 0l1 1a3.5 3.5 0 0 1 0 5l-1.5 1.5a3.5 3.5 0 0 1-5 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M15 15.5a3.5 3.5 0 0 1-5 0l-1-1a3.5 3.5 0 0 1 0-5L10.5 8a3.5 3.5 0 0 1 5 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'center':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
        </svg>
      );
    case 'spouse':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 20s-6-3.8-8-8.1C2.7 9.3 4.2 6 7.5 6c1.9 0 3.2 1 4.5 2.5C13.3 7 14.6 6 16.5 6C19.8 6 21.3 9.3 20 11.9C18 16.2 12 20 12 20Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case 'exSpouse':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 20s-6-3.8-8-8.1C2.7 9.3 4.2 6 7.5 6c1.9 0 3.2 1 4.5 2.5C13.3 7 14.6 6 16.5 6C19.8 6 21.3 9.3 20 11.9C18 16.2 12 20 12 20Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'parentChild':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="5.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="7" cy="18.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="17" cy="18.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 8v4M7 16v-2h10v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'sibling':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 10.5v3.5M16 10.5v3.5M8 14h8M5 19c0-2.2 1.8-4 4-4M15 15c2.2 0 4 1.8 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'inLaw':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M7 8.5a3.5 3.5 0 0 1 5 0l.8.8M17 15.5a3.5 3.5 0 0 1-5 0l-.8-.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M9.5 14.5l5-5M13.5 16.5l4-4M6.5 10.5l4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'reverse':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M7 7h11l-3-3M17 17H6l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'delete':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'createAccount':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5M18 8v6M15 11h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'accounts':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="17" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M3.5 19c0-2.8 2.2-5 5-5s5 2.2 5 5M14 19c0-1.9 1.6-3.5 3.5-3.5S21 17.1 21 19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'notifications':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'audit':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M7 4h10l3 3v13H7z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M17 4v4h4M10 12h6M10 16h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'labels':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M4 12l8-8h7l1 1v7l-8 8L4 12Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="15.5" cy="8.5" r="1.25" fill="currentColor" />
        </svg>
      );
    case 'language':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M4 6h10M9 6c0 6-2 10-5 12M7 12c1.2 1.8 2.8 3.4 5 4.8M14 8h6M17 8v10M14.5 15h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'themeLight':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'themeDark':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M15 4a7.5 7.5 0 1 0 5 13.1A8.5 8.5 0 1 1 15 4Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case 'logout':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M18 12H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
};

const ActionLabel: React.FC<{ text: string; icon: ActionIconName; badge?: React.ReactNode }> = ({ text, icon, badge }) => (
  <>
    <span className="header-action-main">
      <span className="header-action-icon" aria-hidden="true">
        <ActionIcon name={icon} />
      </span>
      <span className="header-action-text">{text}</span>
    </span>
    {badge}
  </>
);

interface HeaderProps {
  onAddMember: () => void;
  onFocusMe: () => void;
  onClearAllDim: () => void;
  hasActiveDimming: boolean;
  onExpandAllCollapsed: () => void;
  hasCollapsedNodes: boolean;
  onShowAllHiddenNodes: () => void;
  hasHiddenNodes: boolean;
  onCaptureScreenshot: () => void;
  screenshotBusy: boolean;
  selectedNode: string | null;
  selectedEdge: string | null;
  selectedEdgeType?: string | null;
  linkMode: { from: string } | null;
  onStartLink: () => void;
  onSetCenter: () => void;
  onUpdateRelationship: (type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law') => void;
  onReverseRelationship: () => void;
  onDeleteRelationship: () => void;
  onUndo: () => void;
  canUndo: boolean;
  readOnly?: boolean;
  isAdmin?: boolean;
  onManageUsers?: () => void;
  onManageNotifications?: () => void;
  onManageAuditLogs?: () => void;
  onManageRelationshipNames?: () => void;
  pendingNotificationCount?: number;
  onManageSessions?: () => void;
  onOpenAccount?: () => void;
  onOpenSettings?: () => void;
  onCreateUser?: () => void;
  username?: string | null;
  onLogout: () => void;
  themeMode?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onSearch: (query: string) => void;
  searchOptions: SearchablePerson[];
  relationshipTypeLabelMap?: Partial<Record<RelationshipTypeKey, string>>;
}

export const Header: React.FC<HeaderProps> = ({
  onAddMember,
  onFocusMe,
  onClearAllDim,
  hasActiveDimming,
  onExpandAllCollapsed,
  hasCollapsedNodes,
  onShowAllHiddenNodes,
  hasHiddenNodes,
  onCaptureScreenshot,
  screenshotBusy,
  selectedNode,
  selectedEdge,
  selectedEdgeType,
  linkMode,
  onStartLink,
  onSetCenter,
  onUpdateRelationship,
  onReverseRelationship,
  onDeleteRelationship,
  onUndo,
  canUndo,
  readOnly,
  isAdmin,
  onManageUsers,
  onManageNotifications,
  onManageAuditLogs,
  onManageRelationshipNames,
  pendingNotificationCount,
  onManageSessions,
  onOpenAccount,
  onOpenSettings,
  onCreateUser,
  username,
  onLogout,
  themeMode,
  onToggleTheme,
  onSearch,
  searchOptions,
  relationshipTypeLabelMap,
}) => {
  const { language, toggleLanguage, t } = useI18n();
  const [searchText, setSearchText] = useState('');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopMenuRef = useRef<HTMLDivElement | null>(null);
  const searchBoxRef = useRef<HTMLFormElement | null>(null);
  const editDisabled = Boolean(readOnly);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    onSearch(searchText);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchText(value);
    if (value.trim()) {
      onSearch(value);
    }
  };

  const hasSelection = Boolean(selectedNode || selectedEdge);
  const getRelationshipLabel = (type: RelationshipTypeKey) => (
    language === 'en'
      ? t(`relationship.${type}`)
      : (relationshipTypeLabelMap?.[type] || t(`relationship.${type}`))
  );
  const spouseToggleType: 'spouse' | 'ex_spouse' = selectedEdgeType === 'spouse' ? 'ex_spouse' : 'spouse';
  const spouseToggleLabel = `${t('header.setAsPrefix')}${getRelationshipLabel(spouseToggleType)}`;
  const parentChildLabel = `${t('header.setAsPrefix')}${getRelationshipLabel('parent_child')}`;
  const siblingLabel = `${t('header.setAsPrefix')}${getRelationshipLabel('sibling')}`;
  const inLawLabel = `${t('header.setAsPrefix')}${getRelationshipLabel('in_law')}`;
  const hasPendingNotifications = Boolean(pendingNotificationCount && pendingNotificationCount > 0);
  const pendingLabel = pendingNotificationCount && pendingNotificationCount > 99
    ? '99+'
    : String(pendingNotificationCount || 0);
  const themeToggleLabel = themeMode === 'dark' ? t('header.switchToLight') : t('header.switchToDark');
  const closeActionMenu = () => setActionMenuOpen(false);
  const closeMobileMenu = () => setMobileMenuOpen(false);

  const mobileOptions = useMemo(() => {
    const query = searchText.trim();
    if (!query) return [];
    const matchesQuery = createPersonSearchMatcher(query);
    return searchOptions
      .filter((option) => matchesQuery(option))
      .slice(0, 8);
  }, [searchText, searchOptions]);

  useEffect(() => {
    setActionMenuOpen(false);
    setMobileMenuOpen(false);
    setDesktopMenuOpen(false);
  }, [selectedNode, selectedEdge]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!mobileMenuRef.current || !target) return;
      if (!mobileMenuRef.current.contains(target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!desktopMenuOpen) return;
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!desktopMenuRef.current || !target) return;
      if (!desktopMenuRef.current.contains(target)) {
        setDesktopMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [desktopMenuOpen]);

  useEffect(() => {
    if (!actionMenuOpen) return;
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!actionMenuRef.current || !target) return;
      if (!actionMenuRef.current.contains(target)) {
        setActionMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [actionMenuOpen]);

  useEffect(() => {
    const closeMenusOnBlur = () => {
      setActionMenuOpen(false);
      setMobileMenuOpen(false);
      setDesktopMenuOpen(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        closeMenusOnBlur();
      }
    };
    window.addEventListener('blur', closeMenusOnBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', closeMenusOnBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!mobileOptions.length) return;
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!searchBoxRef.current || !target) return;
      if (!searchBoxRef.current.contains(target)) {
        setSearchText('');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchText('');
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOptions.length]);

  return (
    <header className="header">
      {/* <h1>家族譜圖 Clan Node</h1> */}
      <div className="controls">
        <form className="search-box" onSubmit={handleSearch} ref={searchBoxRef}>
          <input
            className="search-input"
            type="text"
            placeholder={t('header.searchPlaceholder')}
            value={searchText}
            id="clan-search-input"
            onChange={handleSearchChange}
            onFocus={() => {
              void preloadNameSearchConverters();
            }}
          />
          <button
            className="btn-secondary btn-icon icon-only-btn"
            type="submit"
            aria-label={t('common.search')}
            title={t('common.search')}
          >
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          </button>
          {mobileOptions.length > 0 && (
            <div className="mobile-search-results">
              {mobileOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="mobile-search-item"
                  onClick={() => {
                    onSearch(option.id);
                    setSearchText('');
                  }}
                >
                  <span>{option.name}</span>
                  {option.english_name && <span className="mobile-search-sub">{option.english_name}</span>}
                </button>
              ))}
            </div>
          )}
        </form>
        <div className="header-mobile-menu mobile-visible" ref={mobileMenuRef}>
          <button
            type="button"
            className="btn-secondary btn-icon icon-only-btn"
            aria-label={t('header.menu')}
            title={t('header.menu')}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          </button>
          {mobileMenuOpen && (
            <div className="header-mobile-panel">
              {username && <div className="header-mobile-label">{username}</div>}
              {editDisabled && <div className="header-mobile-label">{t('header.readOnly')}</div>}
              {onManageSessions && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageSessions();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.sessionManagement')} icon="sessions" />
                </button>
              )}
              {onOpenAccount && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onOpenAccount();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.accountProfile')} icon="accounts" />
                </button>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onOpenSettings();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.graphSettings')} icon="settings" />
                </button>
              )}
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onClearAllDim();
                  closeMobileMenu();
                }}
                disabled={!hasActiveDimming}
              >
                <ActionLabel text={t('header.clearAllDimming')} icon="clearDim" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onExpandAllCollapsed();
                  closeMobileMenu();
                }}
                disabled={!hasCollapsedNodes}
              >
                <ActionLabel text={t('header.expandAllCollapsed')} icon="expand" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onShowAllHiddenNodes();
                  closeMobileMenu();
                }}
                disabled={!hasHiddenNodes}
              >
                <ActionLabel text={t('header.showAllHiddenNodes')} icon="showHidden" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onCaptureScreenshot();
                  closeMobileMenu();
                }}
                disabled={screenshotBusy}
              >
                <ActionLabel text={t('header.takeScreenshot')} icon="screenshot" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onUndo();
                  closeMobileMenu();
                }}
                disabled={!canUndo || editDisabled}
              >
                <ActionLabel text={t('header.undo')} icon="undo" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onAddMember();
                  closeMobileMenu();
                }}
                disabled={editDisabled}
              >
                <ActionLabel text={t('header.addMember')} icon="addMember" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onFocusMe();
                  closeMobileMenu();
                }}
              >
                <ActionLabel text={t('header.myLocation')} icon="myLocation" />
              </button>
              {selectedNode && (
                <>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onStartLink();
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={linkMode ? t('header.selectTarget') : t('header.createRelationship')} icon="relationship" />
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onSetCenter();
                      closeMobileMenu();
                    }}
                  >
                    <ActionLabel text={t('header.setCenter')} icon="center" />
                  </button>
                </>
              )}
              {selectedEdge && (
                <>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onUpdateRelationship(spouseToggleType);
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={spouseToggleLabel} icon={spouseToggleType === 'spouse' ? 'spouse' : 'exSpouse'} />
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onUpdateRelationship('parent_child');
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={parentChildLabel} icon="parentChild" />
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onUpdateRelationship('sibling');
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={siblingLabel} icon="sibling" />
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onUpdateRelationship('in_law');
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={inLawLabel} icon="inLaw" />
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onReverseRelationship();
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={t('header.reverseDirection')} icon="reverse" />
                  </button>
                  <button
                    type="button"
                    className="header-action-item danger"
                    onClick={() => {
                      onDeleteRelationship();
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    <ActionLabel text={t('header.deleteRelationship')} icon="delete" />
                  </button>
                </>
              )}
              {isAdmin && onCreateUser && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onCreateUser();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.createAccount')} icon="createAccount" />
                </button>
              )}
              {isAdmin && onManageUsers && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageUsers();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.accountManagement')} icon="accounts" />
                </button>
              )}
              {isAdmin && onManageNotifications && (
                <button
                  type="button"
                  className="header-action-item header-action-item-with-badge"
                  onClick={() => {
                    onManageNotifications();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel
                    text={t('header.notificationManagement')}
                    icon="notifications"
                    badge={hasPendingNotifications ? <span className="header-notice-badge">{pendingLabel}</span> : undefined}
                  />
                </button>
              )}
              {isAdmin && onManageAuditLogs && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageAuditLogs();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.auditLogs')} icon="audit" />
                </button>
              )}
              {isAdmin && onManageRelationshipNames && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageRelationshipNames();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={t('header.relationshipNameManagement')} icon="labels" />
                </button>
              )}
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  toggleLanguage();
                  closeMobileMenu();
                }}
              >
                <ActionLabel text={t('header.switchLanguage')} icon="language" />
              </button>
              {onToggleTheme && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onToggleTheme();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={themeToggleLabel} icon={themeMode === 'dark' ? 'themeLight' : 'themeDark'} />
                </button>
              )}
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onLogout();
                  closeMobileMenu();
                }}
              >
                <ActionLabel text={t('common.logout')} icon="logout" />
              </button>
            </div>
          )}
        </div>
        <button
          onClick={onAddMember}
          className="btn-primary btn-icon icon-only-btn desktop-visible"
          aria-label={t('header.addMember')}
          title={t('header.addMember')}
          disabled={editDisabled}
        >
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        </button>
        {hasSelection && (
          <div className="header-action-menu desktop-visible" ref={actionMenuRef}>
            <button
              className="btn-secondary btn-icon icon-only-btn"
              type="button"
              onClick={() => {
                setDesktopMenuOpen(false);
                setActionMenuOpen((prev) => !prev);
              }}
              aria-label={t('header.nodeActions')}
              title={t('header.nodeActions')}
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 4v4M17 4v4M4 8h16M7 12h10M7 16h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            {actionMenuOpen && (
              <div className="header-action-panel">
                {selectedNode && (
                  <>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onStartLink();
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={linkMode ? t('header.selectTarget') : t('header.createRelationship')} icon="relationship" />
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onSetCenter();
                        closeActionMenu();
                      }}
                    >
                      <ActionLabel text={t('header.setCenter')} icon="center" />
                    </button>
                  </>
                )}
                {selectedEdge && (
                  <>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onUpdateRelationship(spouseToggleType);
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={spouseToggleLabel} icon={spouseToggleType === 'spouse' ? 'spouse' : 'exSpouse'} />
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onUpdateRelationship('parent_child');
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={parentChildLabel} icon="parentChild" />
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onUpdateRelationship('sibling');
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={siblingLabel} icon="sibling" />
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onUpdateRelationship('in_law');
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={inLawLabel} icon="inLaw" />
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onReverseRelationship();
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={t('header.reverseDirection')} icon="reverse" />
                    </button>
                    <button
                      type="button"
                      className="header-action-item danger"
                      onClick={() => {
                        onDeleteRelationship();
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      <ActionLabel text={t('header.deleteRelationship')} icon="delete" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <div className="header-action-menu header-overflow-menu desktop-visible" ref={desktopMenuRef}>
          <button
            className="btn-secondary btn-icon icon-only-btn"
            type="button"
            onClick={() => {
              setActionMenuOpen(false);
              setDesktopMenuOpen((prev) => !prev);
            }}
            aria-label={t('header.moreActions')}
            title={t('header.moreActions')}
          >
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="6" cy="12" r="1.8" fill="currentColor" />
                <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                <circle cx="18" cy="12" r="1.8" fill="currentColor" />
              </svg>
            </span>
          </button>
          {desktopMenuOpen && (
            <div className="header-action-panel header-overflow-panel">
              {username && <div className="header-mobile-label">{username}</div>}
              {editDisabled && <div className="header-mobile-label">{t('header.readOnly')}</div>}
              {onManageSessions && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageSessions();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.sessionManagement')} icon="sessions" />
                </button>
              )}
              {onOpenAccount && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onOpenAccount();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.accountProfile')} icon="accounts" />
                </button>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onOpenSettings();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.graphSettings')} icon="settings" />
                </button>
              )}
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onFocusMe();
                  setDesktopMenuOpen(false);
                }}
              >
                <ActionLabel text={t('header.myLocation')} icon="myLocation" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onUndo();
                  setDesktopMenuOpen(false);
                }}
                disabled={!canUndo || editDisabled}
              >
                <ActionLabel text={t('header.undo')} icon="undo" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onClearAllDim();
                  setDesktopMenuOpen(false);
                }}
                disabled={!hasActiveDimming}
              >
                <ActionLabel text={t('header.clearAllDimming')} icon="clearDim" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onExpandAllCollapsed();
                  setDesktopMenuOpen(false);
                }}
                disabled={!hasCollapsedNodes}
              >
                <ActionLabel text={t('header.expandAllCollapsed')} icon="expand" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onShowAllHiddenNodes();
                  setDesktopMenuOpen(false);
                }}
                disabled={!hasHiddenNodes}
              >
                <ActionLabel text={t('header.showAllHiddenNodes')} icon="showHidden" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onCaptureScreenshot();
                  setDesktopMenuOpen(false);
                }}
                disabled={screenshotBusy}
              >
                <ActionLabel text={t('header.takeScreenshot')} icon="screenshot" />
              </button>
              {isAdmin && onCreateUser && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onCreateUser();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.createAccount')} icon="createAccount" />
                </button>
              )}
              {isAdmin && onManageUsers && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageUsers();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.accountManagement')} icon="accounts" />
                </button>
              )}
              {isAdmin && onManageNotifications && (
                <button
                  type="button"
                  className="header-action-item header-action-item-with-badge"
                  onClick={() => {
                    onManageNotifications();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel
                    text={t('header.notificationManagement')}
                    icon="notifications"
                    badge={hasPendingNotifications ? <span className="header-notice-badge">{pendingLabel}</span> : undefined}
                  />
                </button>
              )}
              {isAdmin && onManageAuditLogs && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageAuditLogs();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.auditLogs')} icon="audit" />
                </button>
              )}
              {isAdmin && onManageRelationshipNames && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageRelationshipNames();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={t('header.relationshipNameManagement')} icon="labels" />
                </button>
              )}
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  toggleLanguage();
                  setDesktopMenuOpen(false);
                }}
              >
                <ActionLabel text={t('header.switchLanguage')} icon="language" />
              </button>
              {onToggleTheme && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onToggleTheme();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={themeToggleLabel} icon={themeMode === 'dark' ? 'themeLight' : 'themeDark'} />
                </button>
              )}
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onLogout();
                  setDesktopMenuOpen(false);
                }}
              >
                <ActionLabel text={t('common.logout')} icon="logout" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
