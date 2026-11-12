import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { RAIL_WIDTH, railMax } from './rail-width.ts';

/** How far an arrow key moves the edge. */
const STEP = 16;

/**
 * The open right rail's left edge, dragged to make the rail wider or narrower: dragging left widens it. Arrow keys move
 * it too (left widens), Home and End go to the narrowest and widest, and a double click puts the default back.
 * `onDragging` tells the rail to drop its width transition while the edge follows the pointer.
 */
export function RailResizer({
  width,
  onWidth,
  onDone,
  onReset,
  onDragging,
}: {
  readonly width: number;
  /** The width while dragging (not kept yet). */
  readonly onWidth: (width: number) => void;
  /** The width the drag (or a key) ended on: kept. */
  readonly onDone: (width: number) => void;
  readonly onReset: () => void;
  readonly onDragging: (dragging: boolean) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const widthAt = (clientX: number) => {
    const from = start.current;
    return from === null ? width : from.width + (from.x - clientX);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    onDone(widthAt(event.clientX));
    start.current = null;
    setActive(false);
    onDragging(false);
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next: Record<string, number> = {
      ArrowLeft: width + STEP,
      ArrowRight: width - STEP,
      Home: RAIL_WIDTH.min,
      End: railMax(),
    };
    const to = next[event.key];
    if (to === undefined) return;
    event.preventDefault();
    onDone(to);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter; <hr> cannot take the pointer and keys.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the right rail"
      aria-valuenow={Math.round(width)}
      aria-valuemin={RAIL_WIDTH.min}
      aria-valuemax={Math.round(railMax())}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        setActive(true);
        onDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(event) => {
        if (start.current !== null) onWidth(widthAt(event.clientX));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-3 -left-1 z-10 flex w-3 cursor-col-resize justify-center outline-none"
    >
      <span
        aria-hidden="true"
        className={cx(
          'h-full w-0.5 rounded-full transition-colors',
          active ? 'bg-blue' : 'bg-transparent group-hover:bg-line-2 group-focus-visible:bg-blue',
        )}
      />
    </div>
  );
}
