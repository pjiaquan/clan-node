import React from 'react';

interface ContextMenuProps {
  id: string;
  title?: string | null;
  top: number;
  left: number;
  onSetCenter: (id: string) => void;
  onStartLink: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onCopyTitle: (title: string) => void;
  onToggleDimRelatives: (id: string) => void;
  onToggleDimNonRelatives: (id: string) => void;
  onDuplicateBottomRight: (id: string) => void;
  selectedCount: number;
  onAlignHorizontal: () => void;
  onAlignVertical: () => void;
  dimRelativesActive: boolean;
  dimNonRelativesActive: boolean;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ 
  top, 
  left, 
  id, 
  title,
  onSetCenter, 
  onStartLink, 
  onEdit,
  onDelete,
  onCopyTitle,
  onToggleDimRelatives,
  onToggleDimNonRelatives,
  onDuplicateBottomRight,
  selectedCount,
  onAlignHorizontal,
  onAlignVertical,
  dimRelativesActive,
  dimNonRelativesActive,
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
          onEdit(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        編輯成員...
      </button>
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
      <button 
        onClick={() => {
          if (title) {
            onCopyTitle(title);
          }
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        disabled={!title}
        title={title ? '' : '沒有稱呼可複製'}
      >
        複製稱呼
      </button>
      <button
        onClick={() => {
          onDuplicateBottomRight(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        複製到右下
      </button>
      {selectedCount > 1 && (
        <button
          onClick={() => {
            onAlignHorizontal();
            onClose();
          }}
          style={menuItemStyle}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          水平對齊（平均間距）
        </button>
      )}
      {selectedCount > 1 && (
        <button
          onClick={() => {
            onAlignVertical();
            onClose();
          }}
          style={menuItemStyle}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          垂直對齊（平均間距）
        </button>
      )}
      <button 
        onClick={() => {
          onToggleDimRelatives(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {dimRelativesActive ? '取消淡化' : '淡化手足/父母'}
      </button>
      <button 
        onClick={() => {
          onToggleDimNonRelatives(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {dimNonRelativesActive ? '取消淡化' : '淡化非手足/父母'}
      </button>
      <button 
        onClick={() => {
          onDelete(id);
          onClose();
        }}
        style={{ ...menuItemStyle, color: '#b91c1c' }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        刪除成員
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
