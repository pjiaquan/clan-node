import React from 'react';

interface ContextMenuProps {
  id: string;
  top: number;
  left: number;
  onSetCenter: (id: string) => void;
  onStartLink: (id: string) => void;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ 
  top, 
  left, 
  id, 
  onSetCenter, 
  onStartLink, 
  onClose 
}) => {
  return (
    <div 
      className="context-menu" 
      style={{ 
        position: 'fixed',
        top, 
        left,
        zIndex: 1000,
        backgroundColor: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '0.375rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        padding: '0.5rem 0',
        minWidth: '150px'
      }}
    >
      <button 
        onClick={() => {
          onSetCenter(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        設為中心
      </button>
      <button 
        onClick={() => {
          onStartLink(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        建立關係...
      </button>
    </div>
  );
};

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '0.5rem 1rem',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: '#1e293b',
  fontSize: '0.875rem'
};
