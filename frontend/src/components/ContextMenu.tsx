import React, { useState } from 'react';
import { useI18n } from '../i18n';

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
  onReportIssue: (id: string) => void;
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
  onReportIssue,
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
  const { t } = useI18n();
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
          {t('context.editMember')}
        </button>
      )}
      <button
        onClick={() => {
          onReportIssue(id);
          onClose();
        }}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {t('context.reportIssue')}
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
        {t('context.setCenter')}
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
          {t('context.alignHorizontal')}
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
          {t('context.alignVertical')}
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
          {t('context.createRelationship')}
        </button>
      )}
      <button
        onClick={() => setCopyOpen((prev) => !prev)}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {t('context.copy')} {copyOpen ? '▾' : '▸'}
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
            title={title ? '' : t('context.noTitleToCopy')}
          >
            {t('context.copyTitle')}
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
              {t('context.duplicateBottomRight')}
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
        {t('context.collapse')} {collapseOpen ? '▾' : '▸'}
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
            {maternalCollapsed ? t('context.expandMaternal') : t('context.collapseMaternal')}
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
            {paternalCollapsed ? t('context.expandPaternal') : t('context.collapsePaternal')}
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
            {childrenCollapsed ? t('context.expandChildren') : t('context.collapseChildren')}
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
            {siblingsCollapsed ? t('context.expandSiblings') : t('context.collapseSiblings')}
          </button>
        </>
      )}
      <button 
        onClick={() => setDimOpen((prev) => !prev)}
        style={menuItemStyle}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {t('context.dimming')} {dimOpen ? '▾' : '▸'}
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
            {dimSingleActive ? t('context.clearSingleDim') : t('context.dimThisNode')}
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
            {dimRelativesActive ? t('context.clearDimRelatives') : t('context.dimRelatives')}
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
            {dimNonRelativesActive ? t('context.clearDimNonRelatives') : t('context.dimNonRelatives')}
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
            {t('context.delete')} {deleteOpen ? '▾' : '▸'}
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
                {t('context.deleteMember')}
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
                {t('context.deleteAllRelationships')}
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
                {t('context.deleteSiblingRelationships')}
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
                {t('context.deleteChildRelationships')}
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
