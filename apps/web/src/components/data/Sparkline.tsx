import { useId, useState } from 'react';
import { cx } from '../cx.ts';

/** The view box: one unit per point across, 0–100 down; drawn stretched, the strokes kept at their own width. */
const HEIGHT = 100;

/** The line as SVG path data, broken at every null point (a gap: no reading then). */
function linePath(points: readonly (number | null)[], top: number): string {
  let path = '';
  let open = false;
  points.forEach((value, index) => {
    if (value === null) {
      open = false;
      return;
    }
    const y = HEIGHT - (Math.min(value, top) / top) * HEIGHT;
    path += `${open ? 'L' : 'M'}${index} ${y.toFixed(2)} `;
    open = true;
  });
  return path.trim();
}

/** The reading under the pointer, above the line's right end. */
function Readout({ text }: { readonly text: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -top-7 right-0 rounded-md bg-ink px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-canvas tabular shadow-float"
    >
      {text}
    </span>
  );
}

export interface SparklineProps {
  /** The values, oldest first; null where there was no reading. */
  readonly points: readonly (number | null)[];
  /** What it shows, for screen readers ("Load per CPU over 24 hours, now 0.40"). */
  readonly label: string;
  /** A dashed line at this value; the line turns red above it. */
  readonly threshold?: number;
  /** The top of the scale; the larger of the highest value and 1.25 × the threshold by default. */
  readonly max?: number;
  /** The reading of the point under the pointer ("14:05 · 0.62"). */
  readonly pointText?: (index: number) => string;
  readonly className?: string;
}

/**
 * A small line of values over time with no axes (a machine's load over 24 hours): gaps where a value is missing, a
 * dashed threshold line, the part above it in red, and the reading under the pointer.
 */
export function Sparkline({ points, label, threshold, max, pointText, className }: SparklineProps) {
  const clip = useId();
  const [hover, setHover] = useState<number>();
  const values = points.filter((value): value is number => value !== null);
  const top = max ?? Math.max(...values, (threshold ?? 0) * 1.25, Number.EPSILON);
  const width = Math.max(points.length - 1, 1);
  const line = linePath(points, top);
  const limitY = threshold === undefined ? undefined : HEIGHT - (Math.min(threshold, top) / top) * HEIGHT;
  const stroke = { fill: 'none', strokeWidth: 1.75, vectorEffect: 'non-scaling-stroke' } as const;
  const tip = hover === undefined ? undefined : pointText?.(hover);
  return (
    <span className={cx('relative block h-10', className)}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="size-full overflow-visible"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(Math.round(((event.clientX - box.left) / box.width) * width));
        }}
        onPointerLeave={() => setHover(undefined)}
      >
        <clipPath id={clip}>
          <rect x={0} y={0} width={width} height={limitY ?? 0} />
        </clipPath>
        {limitY !== undefined && (
          <line
            x1={0}
            x2={width}
            y1={limitY}
            y2={limitY}
            strokeDasharray="3 3"
            className="stroke-faint"
            {...stroke}
            strokeWidth={1}
          />
        )}
        <path d={line} className="stroke-blue" {...stroke} />
        {limitY !== undefined && (
          <path d={line} clipPath={`url(#${clip})`} className="stroke-failed" {...stroke} />
        )}
        {hover !== undefined && (
          <line
            x1={hover}
            x2={hover}
            y1={0}
            y2={HEIGHT}
            className="stroke-line-2"
            {...stroke}
            strokeWidth={1}
          />
        )}
      </svg>
      {tip && <Readout text={tip} />}
    </span>
  );
}
