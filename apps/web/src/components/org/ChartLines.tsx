import { cx } from '../cx.ts';
import { type ChartLayout, edgePath } from './layout.ts';

/**
 * The lines of the chart canvas, under its cards: an elbow from each manager down to each report, with rounded
 * corners. `faded` (the principals being dragged away) draws the line into each of them faint.
 */
export function ChartLines({
  layout,
  faded,
}: {
  readonly layout: ChartLayout;
  readonly faded?: ReadonlySet<string> | undefined;
}) {
  return (
    <svg
      aria-hidden="true"
      width={layout.width}
      height={layout.height}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      {layout.edges.map((edge) => (
        <path
          key={`${edge.from}>${edge.to}`}
          d={edgePath(edge.points)}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          className={cx('stroke-line-2 transition-opacity', faded?.has(edge.to) && 'opacity-30')}
        />
      ))}
    </svg>
  );
}
