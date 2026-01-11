import React from 'react';

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
}) => {
  return (
    <header className="header">
      <h1>家族譜圖 Clan Node</h1>
      <div className="controls">
        <button onClick={onUndo} className="btn-secondary" disabled={!canUndo} title="Ctrl+Z">
          復原
        </button>
        <button onClick={onAddMember} className="btn-primary">
          新增成員
        </button>
        {selectedNode && (
          <>
            <button onClick={onStartLink} className="btn-secondary">
              {linkMode ? '選擇目標...' : '建立關係'}
            </button>
            <button onClick={onSetCenter} className="btn-secondary">
              設為中心
            </button>
          </>
        )}
        {selectedEdge && (
          <>
            <button 
              onClick={() => onUpdateRelationship('spouse')} 
              className="btn-secondary"
            >
              設為配偶
            </button>
            <button 
              onClick={() => onUpdateRelationship('parent_child')} 
              className="btn-secondary"
            >
              設為親子
            </button>
            <button 
              onClick={() => onUpdateRelationship('sibling')} 
              className="btn-secondary"
            >
              設為手足
            </button>
            <button 
              onClick={() => onUpdateRelationship('in_law')} 
              className="btn-secondary"
            >
              設為姻親
            </button>
            <button 
              onClick={onReverseRelationship} 
              className="btn-secondary"
              title="交換起點與終點 (修正父子方向)"
            >
              反轉方向
            </button>
            <button 
              onClick={onDeleteRelationship} 
              className="btn-danger"
              style={{ backgroundColor: '#ef4444', color: 'white', border: 'none' }}
            >
              刪除關係
            </button>
          </>
        )}
        <div className="header-user">
          {username && <span>{username}</span>}
          <button onClick={onLogout} className="btn-secondary">
            登出
          </button>
        </div>
      </div>
    </header>
  );
};
