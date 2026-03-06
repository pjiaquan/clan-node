import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

export type PageHeaderView = 'users' | 'sessions' | 'notifications' | 'auditLogs' | 'kinshipLabels' | 'settings';

type PageHeaderMenuProps = {
  username?: string | null;
  backLabel?: string;
  currentPage?: PageHeaderView;
  isAdmin?: boolean;
  onBack: () => void;
  onManageSessions?: () => void;
  onOpenSettings?: () => void;
  onManageUsers?: () => void;
  onManageNotifications?: () => void;
  onManageAuditLogs?: () => void;
  onManageRelationshipNames?: () => void;
  onLogout: () => Promise<void> | void;
};

const MenuItemLabel: React.FC<{ text: string }> = ({ text }) => (
  <span className="header-action-main">
    <span className="header-action-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M8 7h11M8 12h11M8 17h11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="5" cy="7" r="1.2" fill="currentColor" />
        <circle cx="5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="5" cy="17" r="1.2" fill="currentColor" />
      </svg>
    </span>
    <span className="header-action-text">{text}</span>
  </span>
);

export const PageHeaderMenu: React.FC<PageHeaderMenuProps> = ({
  username,
  backLabel,
  currentPage,
  isAdmin = false,
  onBack,
  onManageSessions,
  onOpenSettings,
  onManageUsers,
  onManageNotifications,
  onManageAuditLogs,
  onManageRelationshipNames,
  onLogout,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const resolvedBackLabel = backLabel || t('pageHeader.backToGraph');

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!menuRef.current || !target) return;
      if (!menuRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnBlur = () => setOpen(false);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setOpen(false);
      }
    };
    window.addEventListener('blur', closeOnBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', closeOnBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [open]);

  return (
    <div className="header-action-menu header-overflow-menu page-header-menu" ref={menuRef}>
      <button
        className="btn-secondary btn-icon icon-only-btn page-header-menu-trigger"
        type="button"
        aria-label={t('common.moreActions')}
        title={t('common.moreActions')}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="btn-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="18" cy="12" r="1.8" fill="currentColor" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="header-action-panel header-overflow-panel">
          {username && <div className="header-mobile-label">{username}</div>}
          <button
            type="button"
            className="header-action-item"
            onClick={() => {
              onBack();
              setOpen(false);
            }}
          >
            <MenuItemLabel text={resolvedBackLabel} />
          </button>
          {currentPage !== 'sessions' && onManageSessions && (
            <button
              type="button"
              className="header-action-item"
              onClick={() => {
                onManageSessions();
                setOpen(false);
              }}
            >
              <MenuItemLabel text={t('header.sessionManagement')} />
            </button>
          )}
          {currentPage !== 'settings' && onOpenSettings && (
            <button
              type="button"
              className="header-action-item"
              onClick={() => {
                onOpenSettings();
                setOpen(false);
              }}
            >
              <MenuItemLabel text={t('header.graphSettings')} />
            </button>
          )}
          {isAdmin && currentPage !== 'users' && onManageUsers && (
            <button
              type="button"
              className="header-action-item"
              onClick={() => {
                onManageUsers();
                setOpen(false);
              }}
            >
              <MenuItemLabel text={t('header.accountManagement')} />
            </button>
          )}
          {isAdmin && currentPage !== 'notifications' && onManageNotifications && (
            <button
              type="button"
              className="header-action-item"
              onClick={() => {
                onManageNotifications();
                setOpen(false);
              }}
            >
              <MenuItemLabel text={t('header.notificationManagement')} />
            </button>
          )}
          {isAdmin && currentPage !== 'auditLogs' && onManageAuditLogs && (
            <button
              type="button"
              className="header-action-item"
              onClick={() => {
                onManageAuditLogs();
                setOpen(false);
              }}
            >
              <MenuItemLabel text={t('header.auditLogs')} />
            </button>
          )}
          {isAdmin && currentPage !== 'kinshipLabels' && onManageRelationshipNames && (
            <button
              type="button"
              className="header-action-item"
              onClick={() => {
                onManageRelationshipNames();
                setOpen(false);
              }}
            >
              <MenuItemLabel text={t('header.relationshipNameManagement')} />
            </button>
          )}
          <button
            type="button"
            className="header-action-item"
            onClick={() => {
              void onLogout();
              setOpen(false);
            }}
          >
            <MenuItemLabel text={t('common.logout')} />
          </button>
        </div>
      )}
    </div>
  );
};
