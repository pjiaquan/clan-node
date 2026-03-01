import React, { useEffect, useMemo, useRef, useState } from 'react';
import { preloadNameSearchConverters } from '../utils/nameSearch';
import { createPersonSearchMatcher, type SearchablePerson } from '../utils/personSearch';
import type { RelationshipTypeKey } from '../types';

const DEFAULT_RELATIONSHIP_TYPE_LABELS: Record<RelationshipTypeKey, string> = {
  parent_child: '親子',
  spouse: '夫妻',
  ex_spouse: '前配偶',
  sibling: '手足',
  in_law: '姻親',
};

const ActionLabel: React.FC<{ text: string; badge?: React.ReactNode }> = ({ text, badge }) => (
  <>
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
  const [searchText, setSearchText] = useState('');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
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
    relationshipTypeLabelMap?.[type] || DEFAULT_RELATIONSHIP_TYPE_LABELS[type]
  );
  const spouseToggleType: 'spouse' | 'ex_spouse' = selectedEdgeType === 'spouse' ? 'ex_spouse' : 'spouse';
  const spouseToggleLabel = `設為${getRelationshipLabel(spouseToggleType)}`;
  const parentChildLabel = `設為${getRelationshipLabel('parent_child')}`;
  const siblingLabel = `設為${getRelationshipLabel('sibling')}`;
  const inLawLabel = `設為${getRelationshipLabel('in_law')}`;
  const hasPendingNotifications = Boolean(pendingNotificationCount && pendingNotificationCount > 0);
  const pendingLabel = pendingNotificationCount && pendingNotificationCount > 99
    ? '99+'
    : String(pendingNotificationCount || 0);
  const themeToggleLabel = themeMode === 'dark' ? '切換淺色' : '切換深色';
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
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!mobileMenuRef.current || !target) return;
      if (!mobileMenuRef.current.contains(target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!desktopMenuOpen) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!desktopMenuRef.current || !target) return;
      if (!desktopMenuRef.current.contains(target)) {
        setDesktopMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [desktopMenuOpen]);

  useEffect(() => {
    if (!mobileOptions.length) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
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
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
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
            placeholder="搜尋姓名或自訂欄位"
            value={searchText}
            id="clan-search-input"
            onChange={handleSearchChange}
            onFocus={() => {
              void preloadNameSearchConverters();
            }}
          />
          <button className="btn-secondary btn-icon icon-only-btn" type="submit" aria-label="搜尋" title="搜尋">
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
            aria-label="選單"
            title="選單"
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
              {editDisabled && <div className="header-mobile-label">只讀</div>}
              {onManageSessions && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageSessions();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text="Session 管理" />
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
                  <ActionLabel text="图形设置" />
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
                <ActionLabel text="取消全部淡化" />
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
                <ActionLabel text="展開全部折疊" />
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
                <ActionLabel text="復原" />
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
                <ActionLabel text="新增成員" />
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onFocusMe();
                  closeMobileMenu();
                }}
              >
                <ActionLabel text="我的位置" />
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
                    <ActionLabel text={linkMode ? '選擇目標...' : '建立關係'} />
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onSetCenter();
                      closeMobileMenu();
                    }}
                  >
                    <ActionLabel text="設為中心" />
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
                    <ActionLabel text={spouseToggleLabel} />
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
                    <ActionLabel text={parentChildLabel} />
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
                    <ActionLabel text={siblingLabel} />
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
                    <ActionLabel text={inLawLabel} />
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
                    <ActionLabel text="反轉方向" />
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
                    <ActionLabel text="刪除關係" />
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
                  <ActionLabel text="新增帳號" />
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
                  <ActionLabel text="帳號管理" />
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
                    text="通知管理"
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
                  <ActionLabel text="修改記錄" />
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
                  <ActionLabel text="稱呼管理" />
                </button>
              )}
              {onToggleTheme && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onToggleTheme();
                    closeMobileMenu();
                  }}
                >
                  <ActionLabel text={themeToggleLabel} />
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
                <ActionLabel text="登出" />
              </button>
            </div>
          )}
        </div>
        <button onClick={onAddMember} className="btn-primary btn-icon icon-only-btn desktop-visible" aria-label="新增成員" title="新增成員" disabled={editDisabled}>
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        </button>
        {hasSelection && (
          <div className="header-action-menu desktop-visible">
            <button
              className="btn-secondary btn-icon icon-only-btn"
              type="button"
              onClick={() => {
                setDesktopMenuOpen(false);
                setActionMenuOpen((prev) => !prev);
              }}
              aria-label="節點操作"
              title="節點操作"
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
                      <ActionLabel text={linkMode ? '選擇目標...' : '建立關係'} />
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onSetCenter();
                        closeActionMenu();
                      }}
                    >
                      <ActionLabel text="設為中心" />
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
                      <ActionLabel text={spouseToggleLabel} />
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
                      <ActionLabel text={parentChildLabel} />
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
                      <ActionLabel text={siblingLabel} />
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
                      <ActionLabel text={inLawLabel} />
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
                      <ActionLabel text="反轉方向" />
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
                      <ActionLabel text="刪除關係" />
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
            aria-label="更多功能"
            title="更多功能"
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
              {editDisabled && <div className="header-mobile-label">只讀</div>}
              {onManageSessions && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onManageSessions();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text="Session 管理" />
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
                  <ActionLabel text="图形设置" />
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
                <ActionLabel text="我的位置" />
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
                <ActionLabel text="復原" />
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
                <ActionLabel text="取消全部淡化" />
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
                <ActionLabel text="展開全部折疊" />
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
                  <ActionLabel text="新增帳號" />
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
                  <ActionLabel text="帳號管理" />
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
                    text="通知管理"
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
                  <ActionLabel text="修改記錄" />
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
                  <ActionLabel text="稱呼管理" />
                </button>
              )}
              {onToggleTheme && (
                <button
                  type="button"
                  className="header-action-item"
                  onClick={() => {
                    onToggleTheme();
                    setDesktopMenuOpen(false);
                  }}
                >
                  <ActionLabel text={themeToggleLabel} />
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
                <ActionLabel text="登出" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
