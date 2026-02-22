import React, { useEffect, useMemo, useRef, useState } from 'react';

interface HeaderProps {
  onAddMember: () => void;
  onFocusMe: () => void;
  onSyncPositions: () => void;
  syncingPositions?: boolean;
  onClearAllDim: () => void;
  hasActiveDimming: boolean;
  selectedNode: string | null;
  selectedEdge: string | null;
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
  onCreateUser?: () => void;
  username?: string | null;
  onLogout: () => void;
  onSearch: (query: string) => void;
  searchOptions: Array<{ id: string; name: string; english_name?: string | null }>;
}

export const Header: React.FC<HeaderProps> = ({
  onAddMember,
  onFocusMe,
  onSyncPositions,
  syncingPositions,
  onClearAllDim,
  hasActiveDimming,
  selectedNode,
  selectedEdge,
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
  onCreateUser,
  username,
  onLogout,
  onSearch,
  searchOptions,
}) => {
  const [searchText, setSearchText] = useState('');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
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
  const closeActionMenu = () => setActionMenuOpen(false);
  const closeMobileMenu = () => setMobileMenuOpen(false);

  const mobileOptions = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];
    return searchOptions
      .filter((option) => {
        const name = option.name.toLowerCase();
        const english = option.english_name?.toLowerCase() ?? '';
        return name.includes(query) || english.includes(query);
      })
      .slice(0, 8);
  }, [searchText, searchOptions]);

  useEffect(() => {
    setActionMenuOpen(false);
    setMobileMenuOpen(false);
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
            placeholder="搜尋姓名"
            value={searchText}
            id="clan-search-input"
            onChange={handleSearchChange}
          />
          <button className="btn-secondary btn-icon" type="submit" aria-label="搜尋">
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="btn-label">搜尋</span>
          </button>
          {mobileOptions.length > 0 && (
            <div className="mobile-search-results">
              {mobileOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="mobile-search-item"
                  onClick={() => {
                    setSearchText(option.name);
                    onSearch(option.name);
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
            className="btn-secondary btn-icon"
            aria-label="選單"
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
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onSyncPositions();
                  closeMobileMenu();
                }}
                disabled={editDisabled || syncingPositions}
              >
                {syncingPositions ? '同步中...' : '同步位置'}
              </button>
              <button
                type="button"
                className="header-action-item"
                onClick={() => {
                  onClearAllDim();
                  closeMobileMenu();
                }}
                disabled={!hasActiveDimming}
              >
                取消全部淡化
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
                復原
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
                新增成員
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
                    {linkMode ? '選擇目標...' : '建立關係'}
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onSetCenter();
                      closeMobileMenu();
                    }}
                  >
                    設為中心
                  </button>
                </>
              )}
              {selectedEdge && (
                <>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onUpdateRelationship('spouse');
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    設為夫妻
                  </button>
                  <button
                    type="button"
                    className="header-action-item"
                    onClick={() => {
                      onUpdateRelationship('ex_spouse');
                      closeMobileMenu();
                    }}
                    disabled={editDisabled}
                  >
                    設為前配偶
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
                    設為親子
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
                    設為手足
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
                    設為姻親
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
                    反轉方向
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
                    刪除關係
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
                  新增帳號
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
                登出
              </button>
            </div>
          )}
        </div>
        <button onClick={onUndo} className="btn-secondary btn-icon" disabled={!canUndo || editDisabled} title="Ctrl+Z" aria-label="復原">
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 7H4v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 12a8 8 0 0 1 13.66-4.66" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="btn-label">復原</span>
        </button>
        <button
          onClick={onSyncPositions}
          className="btn-secondary btn-icon"
          disabled={editDisabled || syncingPositions}
          aria-label="同步位置"
          title="同步全部節點位置"
        >
          <span className="btn-label">{syncingPositions ? '同步中...' : '同步位置'}</span>
        </button>
        <button
          onClick={onClearAllDim}
          className="btn-secondary btn-icon"
          disabled={!hasActiveDimming}
          aria-label="取消全部淡化"
          title="取消全部淡化 (Shift+D)"
        >
          <span className="btn-label">取消淡化</span>
        </button>
        <button onClick={onFocusMe} className="btn-secondary btn-icon focus-me-btn" aria-label="我的位置">
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="btn-label">我的位置</span>
        </button>
        <button onClick={onAddMember} className="btn-primary btn-icon" aria-label="新增成員" disabled={editDisabled}>
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="btn-label">新增成員</span>
        </button>
        {hasSelection && (
          <div className="header-action-menu">
            <button
              className="btn-secondary btn-icon"
              type="button"
              onClick={() => setActionMenuOpen((prev) => !prev)}
              aria-label="節點操作"
            >
              <span className="btn-label">操作</span>
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
                      {linkMode ? '選擇目標...' : '建立關係'}
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onSetCenter();
                        closeActionMenu();
                      }}
                    >
                      設為中心
                    </button>
                  </>
                )}
                {selectedEdge && (
                  <>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onUpdateRelationship('spouse');
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      設為夫妻
                    </button>
                    <button
                      type="button"
                      className="header-action-item"
                      onClick={() => {
                        onUpdateRelationship('ex_spouse');
                        closeActionMenu();
                      }}
                      disabled={editDisabled}
                    >
                      設為前配偶
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
                      設為親子
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
                      設為手足
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
                      設為姻親
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
                      反轉方向
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
                      刪除關係
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <ul className="header-user header-menu">
          {username && (
            <li className="header-menu-item">
              <span>{username}</span>
            </li>
          )}
          {editDisabled && (
            <li className="header-menu-item">
              <span className="readonly-badge">只讀</span>
            </li>
          )}
          {isAdmin && onCreateUser && (
            <li className="header-menu-item">
              <button onClick={onCreateUser} className="btn-secondary btn-icon" aria-label="新增帳號">
                <span className="btn-label">新增帳號</span>
              </button>
            </li>
          )}
          <li className="header-menu-item">
            <button onClick={onLogout} className="btn-secondary btn-icon" aria-label="登出">
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 17l-1.5 1.5A3.5 3.5 0 0 1 3 16V8a3.5 3.5 0 0 1 5.5-2.5L10 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M13 12h8M18 9l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="btn-label">登出</span>
            </button>
          </li>
        </ul>
      </div>
    </header>
  );
};
