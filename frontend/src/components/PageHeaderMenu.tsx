import React, { useEffect, useRef, useState } from 'react';

type PageHeaderMenuProps = {
  username?: string | null;
  backLabel?: string;
  onBack: () => void;
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
  backLabel = '返回族譜',
  onBack,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!menuRef.current || !target) return;
      if (!menuRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
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
        aria-label="更多功能"
        title="更多功能"
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
            <MenuItemLabel text={backLabel} />
          </button>
          <button
            type="button"
            className="header-action-item"
            onClick={() => {
              void onLogout();
              setOpen(false);
            }}
          >
            <MenuItemLabel text="登出" />
          </button>
        </div>
      )}
    </div>
  );
};
