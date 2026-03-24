import { fireEvent, render, screen } from '@testing-library/react';
import { Position } from 'reactflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonNode from './PersonNode';
import { I18nProvider } from './i18n';

vi.mock('reactflow', () => ({
  Handle: ({ className }: { className?: string }) => <div className={className} data-testid="handle" />,
  Position: {
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
    Left: 'left',
  },
}));

describe('PersonNode mobile double tap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the node menu on read-only mobile double tap', () => {
    const onNodeDoubleTap = vi.fn();

    render(
      <I18nProvider>
        <PersonNode
          id="person-1"
          selected={false}
          isConnectable={true}
          xPos={0}
          yPos={0}
          zIndex={0}
          dragging={false}
          targetPosition={Position.Top}
          sourcePosition={Position.Bottom}
          data={{
            id: 'person-1',
            name: 'Alice',
            initial: 'A',
            title: 'Leader',
            formalTitle: 'Leader',
            englishName: '',
            birthTime: '',
            genderColor: '#ff0000',
            interactionLocked: true,
            draggableMobile: false,
            allowNodeDoubleTap: true,
            onNodeDoubleTap,
          }}
          type="person"
        />
      </I18nProvider>
    );

    const node = screen.getByText('Alice').closest('.person-node');
    expect(node).not.toBeNull();

    fireEvent.touchStart(node as HTMLElement, {
      changedTouches: [{ identifier: 1, clientX: 100, clientY: 120 }],
    });
    fireEvent.touchEnd(node as HTMLElement, {
      changedTouches: [{ identifier: 1, clientX: 100, clientY: 120 }],
    });

    vi.advanceTimersByTime(150);

    fireEvent.touchStart(node as HTMLElement, {
      changedTouches: [{ identifier: 1, clientX: 104, clientY: 124 }],
    });
    fireEvent.touchEnd(node as HTMLElement, {
      changedTouches: [{ identifier: 1, clientX: 104, clientY: 124 }],
    });

    expect(onNodeDoubleTap).toHaveBeenCalledTimes(1);
    expect(onNodeDoubleTap).toHaveBeenCalledWith(104, 124);
  });
});
