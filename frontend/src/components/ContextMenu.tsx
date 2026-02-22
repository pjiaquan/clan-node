import React, { useState } from 'react';

interface ContextMenuProps {
  id: string;
  title?: string | null;
  top?: number;
  bottom?: number;
  left: number;
  openUp?: boolean;
  readOnly?: boolean;
  onSetCenter: (id: string) => void;
  onStartLink: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteRelations: (id: string) => void;
  onDeleteSiblingRelations: (id: string) => void;
  onDeleteChildRelations: (id: string) => void;
  onCopyTitle: (title: string) => void;
  onToggleDimSingle: (id: string) => void;
  onToggleDimRelatives: (id: string) => void;
  onToggleDimNonRelatives: (id: string) => void;
  onToggleCollapseMaternal: (id: string) => void;
  onToggleCollapsePaternal: (id: string) => void;
  onToggleCollapseChildren: (id: string) => void;
  onToggleCollapseSiblings: (id: string) => void;
  onDuplicateBottomRight: (id: string) => void;
  selectedCount: number;
  onAlignHorizontal: () => void;
  onAlignVertical: () => void;
  dimRelativesActive: boolean;
  dimNonRelativesActive: boolean;
  dimSingleActive: boolean;
  maternalCollapsed: boolean;
  paternalCollapsed: boolean;
  childrenCollapsed: boolean;
  siblingsCollapsed: boolean;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ 
  top,
  bottom,
  left,
  id, 
  title,
  readOnly,
  onSetCenter, 
  onStartLink, 
  onEdit,
  onDelete,
  onDeleteRelations,
  onDeleteSiblingRelations,
  onDeleteChildRelations,
  onCopyTitle,
  onToggleDimSingle,
  onToggleDimRelatives,
  onToggleDimNonRelatives,
  onToggleCollapseMaternal,
  onToggleCollapsePaternal,
  onToggleCollapseChildren,
  onToggleCollapseSiblings,
  onDuplicateBottomRight,
  selectedCount,
  onAlignHorizontal,
  onAlignVertical,
  dimRelativesActive,
  dimNonRelativesActive,
  dimSingleActive,
  maternalCollapsed,
  paternalCollapsed,
  childrenCollapsed,
  siblingsCollapsed,
  onClose 
}) => {
  const [collapseOpen, setCollapseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [dimOpen, setDimOpen] = useState(false);
  const canEdit = !readOnly;

  return (
    <div 
      className="context-menu" 
      style={{ 
        position: 'fixed',
        top,
        bottom,
        left,
        zIndex: 1000,
        backgroundColor: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: '0.375rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        padding: '0.5rem 0',
        minWidth: '150px',
        maxHeight: '60vh',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        transform: undefined
      }}
    >
      {canEdit && (
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
      )}
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
      {canEdit && selectedCount > 1 && (
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
      {canEdit && selectedCount > 1 && (
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
      {canEdit && (
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
      )}
      <button
        onClick={() => setCopyOpen((prev) => !prev)}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        複製 {copyOpen ? '▾' : '▸'}
      </button>
      {copyOpen && (
        <>
          <button 
            onClick={() => {
              if (title) {
                onCopyTitle(title);
              }
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            disabled={!title}
            title={title ? '' : '沒有稱呼可複製'}
          >
            複製稱呼
          </button>
          {canEdit && (
            <button
              onClick={() => {
                onDuplicateBottomRight(id);
                onClose();
              }}
              style={submenuItemStyle}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              複製到右下
            </button>
          )}
        </>
      )}
      <button
        onClick={() => setCollapseOpen((prev) => !prev)}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        摺疊 {collapseOpen ? '▾' : '▸'}
      </button>
      {collapseOpen && (
        <>
          <button
            onClick={() => {
              onToggleCollapseMaternal(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {maternalCollapsed ? '展開女方家族' : '折疊女方家族'}
          </button>
          <button
            onClick={() => {
              onToggleCollapsePaternal(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {paternalCollapsed ? '展開男方家族' : '折疊男方家族'}
          </button>
          <button
            onClick={() => {
              onToggleCollapseChildren(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {childrenCollapsed ? '展開兒女' : '折疊兒女'}
          </button>
          <button
            onClick={() => {
              onToggleCollapseSiblings(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {siblingsCollapsed ? '展開手足' : '折疊手足'}
          </button>
        </>
      )}
      <button 
        onClick={() => setDimOpen((prev) => !prev)}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        淡化 {dimOpen ? '▾' : '▸'}
      </button>
      {dimOpen && (
        <>
          <button
            onClick={() => {
              onToggleDimSingle(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {dimSingleActive ? '取消單一淡化' : '淡化此節點'}
          </button>
          <button 
            onClick={() => {
              onToggleDimRelatives(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {dimRelativesActive ? '取消淡化手足/父母' : '淡化手足/父母'}
          </button>
          <button 
            onClick={() => {
              onToggleDimNonRelatives(id);
              onClose();
            }}
            style={submenuItemStyle}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            {dimNonRelativesActive ? '取消淡化非手足/父母' : '淡化非手足/父母'}
          </button>
        </>
      )}
      {canEdit && (
        <>
          <button
            onClick={() => setDeleteOpen((prev) => !prev)}
            style={{ ...menuItemStyle, color: '#b91c1c' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            刪除 {deleteOpen ? '▾' : '▸'}
          </button>
          {deleteOpen && (
            <>
              <button 
                onClick={() => {
                  onDelete(id);
                  onClose();
                }}
                style={{ ...submenuItemStyle, color: '#b91c1c' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                刪除成員
              </button>
              <button
                onClick={() => {
                  onDeleteRelations(id);
                  onClose();
                }}
                style={{ ...submenuItemStyle, color: '#b91c1c' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                刪除所有關係
              </button>
              <button
                onClick={() => {
                  onDeleteSiblingRelations(id);
                  onClose();
                }}
                style={{ ...submenuItemStyle, color: '#b91c1c' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                刪除所有手足關係
              </button>
              <button
                onClick={() => {
                  onDeleteChildRelations(id);
                  onClose();
                }}
                style={{ ...submenuItemStyle, color: '#b91c1c' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                刪除所有子女關係
              </button>
            </>
          )}
        </>
      )}
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

const submenuItemStyle: React.CSSProperties = {
  ...menuItemStyle,
  paddingLeft: '1.75rem',
  fontSize: '0.825rem'
};
