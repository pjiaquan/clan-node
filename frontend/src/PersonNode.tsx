import { memo, useRef } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const PersonNode = memo(({ data, selected }: NodeProps) => {
  const highlightHandles = new Set<string>(data.highlightHandles ?? []);
  const tapRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const longPressRef = useRef<{ timer: number | null; x: number; y: number } | null>(null);
  const rawTitle = typeof data.title === 'string' ? data.title : '';
  const isLongTitle = rawTitle.length > 4;
  const displayTitle = isLongTitle ? `${rawTitle.slice(0, 4)}...` : rawTitle;
  return (
    <>
      <Handle type="target" position={Position.Top} id="top-t" className={highlightHandles.has('top-t') ? 'handle-hot' : undefined} />
      <Handle type="source" position={Position.Top} id="top-s" className={highlightHandles.has('top-s') ? 'handle-hot' : undefined} />
      
      <Handle type="target" position={Position.Right} id="right-t" className={highlightHandles.has('right-t') ? 'handle-hot' : undefined} />
      <Handle type="source" position={Position.Right} id="right-s" className={highlightHandles.has('right-s') ? 'handle-hot' : undefined} />
      
      <Handle type="target" position={Position.Bottom} id="bottom-t" className={highlightHandles.has('bottom-t') ? 'handle-hot' : undefined} />
      <Handle type="source" position={Position.Bottom} id="bottom-s" className={highlightHandles.has('bottom-s') ? 'handle-hot' : undefined} />
      
      <Handle type="target" position={Position.Left} id="left-t" className={highlightHandles.has('left-t') ? 'handle-hot' : undefined} />
      <Handle type="source" position={Position.Left} id="left-s" className={highlightHandles.has('left-s') ? 'handle-hot' : undefined} />

      <div
        className={`person-node ${data.interactionLocked ? 'nodrag nopan' : ''} ${selected ? 'selected' : ''} ${data.isCenter ? 'center' : ''} ${data.flashCenter ? 'center-flash' : ''} ${data.flashSearch ? 'search-flash' : ''} ${data.focusHover ? 'focus-hover' : ''}`}
        style={{ borderColor: selected ? '#667eea' : data.genderColor }}
        onPointerDown={(event) => {
          if (!data.onNodeLongPress || !data.allowNodeLongPress || event.pointerType !== 'touch') return;
          if (longPressRef.current?.timer) {
            window.clearTimeout(longPressRef.current.timer);
          }
          longPressRef.current = { timer: null, x: event.clientX, y: event.clientY };
          longPressRef.current.timer = window.setTimeout(() => {
            data.onNodeLongPress(event.clientX, event.clientY);
            longPressRef.current = null;
          }, 550);
        }}
        onPointerMove={(event) => {
          if (!data.onNodeLongPress || !data.allowNodeLongPress || event.pointerType !== 'touch') return;
          const current = longPressRef.current;
          if (!current) return;
          const deltaX = Math.abs(event.clientX - current.x);
          const deltaY = Math.abs(event.clientY - current.y);
          if (deltaX > 8 || deltaY > 8) {
            if (current.timer) window.clearTimeout(current.timer);
            longPressRef.current = null;
          }
        }}
        onPointerUp={(event) => {
          if (!data.onNodeLongPress || !data.allowNodeLongPress || event.pointerType !== 'touch') return;
          const current = longPressRef.current;
          if (!current) return;
          if (current.timer) window.clearTimeout(current.timer);
          longPressRef.current = null;
        }}
        onPointerCancel={() => {
          const current = longPressRef.current;
          if (!current) return;
          if (current.timer) window.clearTimeout(current.timer);
          longPressRef.current = null;
        }}
      >
        {data.hasCollapsedSide && <span className="node-collapse-indicator" />}
      <div
        className="node-avatar nodrag nopan"
        style={{ background: data.genderColor }}
        onPointerDown={(event) => {
          if (!data.onAvatarClick) return;
          tapRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.stopPropagation();
        }}
        onPointerMove={(event) => {
          const tap = tapRef.current;
          if (!tap || tap.pointerId !== event.pointerId) return;
          const deltaX = Math.abs(event.clientX - tap.x);
          const deltaY = Math.abs(event.clientY - tap.y);
          if (deltaX > 8 || deltaY > 8) {
            tap.moved = true;
          }
        }}
        onPointerUp={(event) => {
          if (!data.onAvatarClick) return;
          const tap = tapRef.current;
          if (!tap || tap.pointerId !== event.pointerId) return;
          const deltaX = Math.abs(event.clientX - tap.x);
          const deltaY = Math.abs(event.clientY - tap.y);
          if (!tap.moved && deltaX <= 10 && deltaY <= 10) {
            data.onAvatarClick();
          }
          tapRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          event.stopPropagation();
        }}
        onPointerCancel={() => {
          tapRef.current = null;
        }}
        onTouchEnd={(event) => {
          if (!data.onAvatarClick) return;
          const tap = tapRef.current;
          if (tap && !tap.moved) {
            data.onAvatarClick();
          }
          tapRef.current = null;
          event.stopPropagation();
        }}
        onClick={(event) => {
          if (!data.onAvatarClick) return;
          event.stopPropagation();
          data.onAvatarClick();
        }}
        >
          {data.avatarUrl ? (
            <img src={data.avatarUrl} alt={data.name} />
          ) : (
            data.initial
          )}
        </div>
        <div className="node-name">{data.name}</div>
        {data.title && (
          <div className="node-title">
            <span className="node-title-text" data-title={data.formalTitle || data.title}>
              {displayTitle}
            </span>
            {isLongTitle && <span className="node-title-tooltip">{data.formalTitle || data.title}</span>}
          </div>
        )}
      </div>
    </>
  );
});

export default PersonNode;
