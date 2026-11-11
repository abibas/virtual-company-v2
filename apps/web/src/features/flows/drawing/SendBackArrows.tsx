import type { FlowStepKind } from '@mwc/shared/enums';
import { type RefObject, useId, useLayoutEffect, useRef, useState } from 'react';
import { KIND } from '../words.ts';

/** One send-back to draw: from a Check or Sign-off box back to an earlier one. */
export interface SendBack {
  readonly from: string;
  readonly to: string;
  readonly kind: FlowStepKind;
}

/** Where a box sits in the row: its left edge, width and bottom, in the row's own coordinates. */
interface Box {
  readonly left: number;
  readonly width: number;
  readonly bottom: number;
}

interface Measured {
  readonly map: ReadonlyMap<string, Box>;
  readonly width: number;
  readonly height: number;
}

/** How far below the boxes each lane of arrows runs, and the first lane's depth. */
const LANE = 14;
const FIRST = 16;

/** The room under the row that `count` lanes of arrows take (a curve dips three quarters of its control depth). */
export const lanesRoom = (count: number): number =>
  count === 0 ? 0 : Math.ceil(0.75 * (FIRST + (count - 1) * LANE)) + 10;

/**
 * The boxes of the row (the drawing's own parent, which holds every `data-step` box) by their key, measured after
 * layout and again whenever the row changes size, with the row's full size. The parent is reached from the drawing's
 * own element: a parent's ref is not attached yet when a child's layout effect runs.
 */
function useBoxes(svg: RefObject<SVGSVGElement | null>, version: string): Measured | undefined {
  const [boxes, setBoxes] = useState<Measured>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` (the steps drawn) is what moves the boxes.
  useLayoutEffect(() => {
    const row = svg.current?.parentElement;
    if (!row) return;
    const measure = () => {
      const map = new Map<string, Box>();
      for (const box of row.querySelectorAll<HTMLElement>('[data-step]')) {
        const bottom = box.offsetTop + box.offsetHeight;
        map.set(box.dataset.step ?? '', { left: box.offsetLeft, width: box.offsetWidth, bottom });
      }
      setBoxes({ map, width: row.scrollWidth, height: row.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [svg, version]);
  return boxes;
}

/** The lanes: shorter send-backs run nearer the boxes, so arrows nest instead of crossing. */
function lanesOf(arrows: readonly SendBack[], order: readonly string[]): number[] {
  const span = (arrow: SendBack) => order.indexOf(arrow.from) - order.indexOf(arrow.to);
  const sorted = [...arrows].sort((a, b) => span(a) - span(b));
  return arrows.map((arrow) => sorted.indexOf(arrow));
}

/** One dashed arrow, from under its source box down and back up into its target, in its kind's colour. */
function arrowPath(from: Box, to: Box, lane: number): string {
  const x1 = from.left + from.width / 2 + 10;
  const x2 = to.left + to.width / 2 - 8 - lane * 10;
  const y1 = from.bottom;
  const y2 = to.bottom + 4;
  const depth = Math.max(y1, y2) + FIRST + lane * LANE;
  return `M ${x1} ${y1} C ${x1} ${depth}, ${x2} ${depth}, ${x2} ${y2}`;
}

/**
 * The dashed arrows under the row, each from a Check or Sign-off box back to the step it sends back to, in its kind's
 * colour, drawn over the measured boxes. It sits in the row (positioned), as its last child.
 */
export function SendBackArrows({
  arrows,
  order,
}: {
  readonly arrows: readonly SendBack[];
  /** The steps' keys in order. */
  readonly order: readonly string[];
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svg = useRef<SVGSVGElement>(null);
  const boxes = useBoxes(svg, `${order.join(',')}|${arrows.map((a) => `${a.from}>${a.to}`).join(',')}`);
  const lanes = lanesOf(arrows, order);
  const marker = (kind: FlowStepKind) => `arrow-${id}-${kind}`;
  return (
    <svg
      ref={svg}
      aria-hidden="true"
      width={boxes?.width ?? 0}
      height={boxes?.height ?? 0}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      <defs>
        {(['check', 'signoff', 'work'] as const).map((kind) => (
          <marker
            key={kind}
            id={marker(kind)}
            viewBox="0 0 8 8"
            refX="4"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8 z" style={{ fill: KIND[kind].stroke }} />
          </marker>
        ))}
      </defs>
      {arrows.map((arrow, index) => {
        const from = boxes?.map.get(arrow.from);
        const to = boxes?.map.get(arrow.to);
        if (!from || !to) return null;
        return (
          <path
            key={`${arrow.from}>${arrow.to}`}
            d={arrowPath(from, to, lanes[index] ?? 0)}
            fill="none"
            style={{ stroke: KIND[arrow.kind].stroke }}
            strokeWidth="1.5"
            strokeDasharray="5 4"
            strokeLinecap="round"
            markerEnd={`url(#${marker(arrow.kind)})`}
            opacity="0.85"
          />
        );
      })}
    </svg>
  );
}
