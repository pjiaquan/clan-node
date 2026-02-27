import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const MOBILE_LONG_PRESS_MS = 180;
const MOBILE_LONG_PRESS_CANCEL_DISTANCE = 30;

const PersonNode = memo(({ data, selected }: NodeProps) => {
  const [isFloating, setIsFloating] = useState(false);
  const [nameOverflow, setNameOverflow] = useState(false);
  const highlightHandles = new Set<string>(data.highlightHandles ?? []);
  const tapRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const nameTextRef = useRef<HTMLSpanElement | null>(null);
  const touchLongPressRef = useRef<{
    touchId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    timer: number | null;
    active: boolean;
  } | null>(null);
  const touchGlobalHandlersRef = useRef<{
    move: (event: TouchEvent) => void;
    end: (event: TouchEvent) => void;
    cancel: (event: TouchEvent) => void;
  } | null>(null);
  const rawTitle = typeof data.title === 'string' ? data.title : '';
  const isLongTitle = rawTitle.length > 4;
  const displayTitle = isLongTitle ? `${rawTitle.slice(0, 4)}...` : rawTitle;

  const clearTouchLongPressTimer = () => {
    const state = touchLongPressRef.current;
    if (state?.timer) {
      window.clearTimeout(state.timer);
      state.timer = null;
    }
  };
  const detachGlobalTouchHandlers = () => {
    const handlers = touchGlobalHandlersRef.current;
    if (!handlers) return;
    window.removeEventListener('touchmove', handlers.move);
    window.removeEventListener('touchend', handlers.end);
    window.removeEventListener('touchcancel', handlers.cancel);
    touchGlobalHandlersRef.current = null;
  };
  const finishTouchDrag = (touchId: number) => {
    const current = touchLongPressRef.current;
    if (!current || current.touchId !== touchId) return;
    clearTouchLongPressTimer();
    if (current.active) {
      setIsFloating(false);
      data.onMobileDragEnd?.(data.id);
    }
    touchLongPressRef.current = null;
    detachGlobalTouchHandlers();
  };

  useEffect(() => {
    return () => {
      clearTouchLongPressTimer();
      detachGlobalTouchHandlers();
      touchLongPressRef.current = null;
    };
  }, []);

  useEffect(() => {
    const element = nameTextRef.current;
    if (!element) return;

    const checkOverflow = () => {
      setNameOverflow(element.scrollWidth > element.clientWidth);
    };

    checkOverflow();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => checkOverflow());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [data.name]);

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
        className={`person-node nopan ${data.interactionLocked ? 'nodrag' : ''} ${selected ? 'selected' : ''} ${data.isCenter ? 'center' : ''} ${data.flashCenter ? 'center-flash' : ''} ${data.flashSearch ? 'search-flash' : ''} ${data.focusHover ? 'focus-hover' : ''} ${isFloating ? 'floating' : ''}`}
        style={{
          borderColor: data.genderColor,
          touchAction: data.draggableMobile ? 'none' : undefined,
          userSelect: data.draggableMobile ? 'none' : undefined,
          WebkitUserSelect: data.draggableMobile ? 'none' : undefined,
          WebkitTouchCallout: data.draggableMobile ? 'none' : undefined,
          '--highlight-color': data.genderColor,
          '--highlight-color-35': `${data.genderColor}59`,
          '--highlight-color-15': `${data.genderColor}26`,
          '--highlight-color-18': `${data.genderColor}2E`,
        } as React.CSSProperties}
        onTouchStart={(event) => {
          if (!data.draggableMobile) return;
          const touch = event.changedTouches[0];
          if (!touch) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest('.react-flow__handle')) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();

          detachGlobalTouchHandlers();
          clearTouchLongPressTimer();
          touchLongPressRef.current = {
            touchId: touch.identifier,
            startX: touch.clientX,
            startY: touch.clientY,
            lastX: touch.clientX,
            lastY: touch.clientY,
            timer: null,
            active: false,
          };
          touchLongPressRef.current.timer = window.setTimeout(() => {
            const current = touchLongPressRef.current;
            if (!current || current.touchId !== touch.identifier) return;
            current.active = true;
            current.timer = null;
            setIsFloating(true);
            data.onMobileDragStart?.(data.id);
            const move = (moveEvent: TouchEvent) => {
              const dragging = touchLongPressRef.current;
              if (!dragging || dragging.touchId !== touch.identifier || !dragging.active) return;
              const movingTouch = Array.from(moveEvent.touches).find((item) => item.identifier === touch.identifier);
              if (!movingTouch) return;
              moveEvent.preventDefault();
              const dx = movingTouch.clientX - dragging.lastX;
              const dy = movingTouch.clientY - dragging.lastY;
              if ((dx !== 0 || dy !== 0) && data.onMobileDrag) {
                data.onMobileDrag(data.id, dx, dy);
              }
              dragging.lastX = movingTouch.clientX;
              dragging.lastY = movingTouch.clientY;
            };
            const end = (endEvent: TouchEvent) => {
              const endedTouch = Array.from(endEvent.changedTouches).find((item) => item.identifier === touch.identifier);
              if (!endedTouch) return;
              endEvent.preventDefault();
              finishTouchDrag(touch.identifier);
            };
            const cancel = (cancelEvent: TouchEvent) => {
              const cancelledTouch = Array.from(cancelEvent.changedTouches).find((item) => item.identifier === touch.identifier);
              if (!cancelledTouch) return;
              finishTouchDrag(touch.identifier);
            };
            touchGlobalHandlersRef.current = { move, end, cancel };
            window.addEventListener('touchmove', move, { passive: false });
            window.addEventListener('touchend', end, { passive: false });
            window.addEventListener('touchcancel', cancel, { passive: false });
          }, MOBILE_LONG_PRESS_MS);
        }}
        onTouchMove={(event) => {
          const current = touchLongPressRef.current;
          if (!current) return;
          event.preventDefault();
          event.stopPropagation();

          const touch = Array.from(event.touches).find((item) => item.identifier === current.touchId);
          if (!touch) return;

          if (current.active) {
            return;
          }

          const deltaX = Math.abs(touch.clientX - current.startX);
          const deltaY = Math.abs(touch.clientY - current.startY);
          if (deltaX > MOBILE_LONG_PRESS_CANCEL_DISTANCE || deltaY > MOBILE_LONG_PRESS_CANCEL_DISTANCE) {
            clearTouchLongPressTimer();
            touchLongPressRef.current = null;
          }
        }}
        onTouchEnd={(event) => {
          const current = touchLongPressRef.current;
          const endedTouch = current
            ? Array.from(event.changedTouches).find((item) => item.identifier === current.touchId)
            : null;
          if (!current || !endedTouch) {
            return;
          }

          if (current.active) {
            event.preventDefault();
            finishTouchDrag(current.touchId);
          } else {
            clearTouchLongPressTimer();
            detachGlobalTouchHandlers();
            touchLongPressRef.current = null;
          }
        }}
        onTouchCancel={() => {
          const current = touchLongPressRef.current;
          if (!current) return;
          finishTouchDrag(current.touchId);
        }}
        onContextMenu={(event) => {
          if (data.draggableMobile) {
            event.preventDefault();
          }
        }}
      >
        {data.hasCollapsedSide && <span className="node-collapse-indicator" />}
        <div
          className="node-avatar nodrag nopan"
          style={{ background: data.genderColor }}
          onPointerDown={(event) => {
            if (!data.onAvatarClick) return;
            if (event.pointerType === 'touch') return;
            tapRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.stopPropagation();
          }}
          onPointerMove={(event) => {
            if (event.pointerType === 'touch') return;
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
            if (event.pointerType === 'touch') return;
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
          onTouchEnd={() => {
            if (!data.onAvatarClick) return;
            const tap = tapRef.current;
            if (tap && !tap.moved) {
              data.onAvatarClick();
            }
            tapRef.current = null;
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
        <div className="node-name">
          <span ref={nameTextRef} className="node-name-text">{data.name}</span>
          {nameOverflow && <span className="node-name-tooltip">{data.name}</span>}
        </div>
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
