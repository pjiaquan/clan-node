import React, { useState } from 'react';

interface HeaderProps {
  onAddMember: () => void;
  selectedNode: string | null;
  selectedEdge: string | null;
  linkMode: { from: string } | null;
  onStartLink: () => void;
  onSetCenter: () => void;
  onUpdateRelationship: (type: 'parent_child' | 'spouse' | 'sibling' | 'in_law') => void;
  onReverseRelationship: () => void;
  onDeleteRelationship: () => void;
  onUndo: () => void;
  canUndo: boolean;
  username?: string | null;
  onLogout: () => void;
  onSearch: (query: string) => void;
  searchOptions: Array<{ id: string; name: string; english_name?: string | null }>;
}

export const Header: React.FC<HeaderProps> = ({
  onAddMember,
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
  username,
  onLogout,
  onSearch,
  searchOptions,
}) => {
  const [searchText, setSearchText] = useState('');

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

  return (
    <header className="header">
      {/* <h1>家族譜圖 Clan Node</h1> */}
      <div className="controls">
        <form className="search-box" onSubmit={handleSearch}>
          <input
            className="search-input"
            type="text"
            list="node-search-list"
            placeholder="搜尋姓名"
            value={searchText}
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
          <datalist id="node-search-list">
            {searchOptions.map((option) => (
              <option key={option.id} value={option.name}>
                {option.english_name ? `${option.name} (${option.english_name})` : option.name}
              </option>
            ))}
          </datalist>
        </form>
        <button onClick={onUndo} className="btn-secondary btn-icon" disabled={!canUndo} title="Ctrl+Z" aria-label="復原">
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 7H4v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 12a8 8 0 0 1 13.66-4.66" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="btn-label">復原</span>
        </button>
        <button onClick={onAddMember} className="btn-primary btn-icon" aria-label="新增成員">
          <span className="btn-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="btn-label">新增成員</span>
        </button>
        {selectedNode && (
          <>
            <button onClick={onStartLink} className="btn-secondary btn-icon" aria-label={linkMode ? '選擇目標...' : '建立關係'}>
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 14a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 10a5 5 0 0 0-7.07 0L4.8 12.12a5 5 0 0 0 7.07 7.07L14 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="btn-label">{linkMode ? '選擇目標...' : '建立關係'}</span>
            </button>
            <button onClick={onSetCenter} className="btn-secondary btn-icon" aria-label="設為中心">
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                </svg>
              </span>
              <span className="btn-label">設為中心</span>
            </button>
          </>
        )}
        {selectedEdge && (
          <>
            <button 
              onClick={() => onUpdateRelationship('spouse')} 
              className="btn-secondary btn-icon"
              aria-label="設為夫妻"
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 20s-6-4.35-8-7.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 5.5C18 15.65 12 20 12 20z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="btn-label">設為夫妻</span>
            </button>
            <button 
              onClick={() => onUpdateRelationship('parent_child')} 
              className="btn-secondary btn-icon"
              aria-label="設為親子"
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 4v12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M8 12l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="btn-label">設為親子</span>
            </button>
            <button 
              onClick={() => onUpdateRelationship('sibling')} 
              className="btn-secondary btn-icon"
              aria-label="設為手足"
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM17 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3z" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M4 19c0-3 6-3 6 0M14 19c0-3 6-3 6 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="btn-label">設為手足</span>
            </button>
            <button 
              onClick={() => onUpdateRelationship('in_law')} 
              className="btn-secondary btn-icon"
              aria-label="設為姻親"
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 7h5M12 7a4 4 0 0 1 4 4v1M5 14h14M12 14v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="btn-label">設為姻親</span>
            </button>
            <button 
              onClick={onReverseRelationship} 
              className="btn-secondary btn-icon"
              title="交換起點與終點 (修正父子方向)"
              aria-label="反轉方向"
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="btn-label">反轉方向</span>
            </button>
            <button 
              onClick={onDeleteRelationship} 
              className="btn-danger btn-icon"
              style={{ backgroundColor: '#ef4444', color: 'white', border: 'none' }}
              aria-label="刪除關係"
            >
              <span className="btn-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="btn-label">刪除關係</span>
            </button>
          </>
        )}
        <div className="header-user">
          {username && <span>{username}</span>}
          <button onClick={onLogout} className="btn-secondary btn-icon" aria-label="登出">
            <span className="btn-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 17l-1.5 1.5A3.5 3.5 0 0 1 3 16V8a3.5 3.5 0 0 1 5.5-2.5L10 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M13 12h8M18 9l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="btn-label">登出</span>
          </button>
        </div>
      </div>
    </header>
  );
};
