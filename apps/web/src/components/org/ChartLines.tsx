import { cx } from '../cx.ts';
import { type ChartEdge, type ChartLayout, edgePath } from './layout.ts';

/**
 * The lines of the chart canvas, under its cards: an elbow from each manager down to each report, with rounded
 * corners. `faded` (the principals being dragged away) draws the line into each of them faint. `emphasis` (a
 * highlighted group's lines, as `from>to` keys) draws those lines stronger, on top, and every other line faint.
 */
export function ChartLines({
  layout,
  faded,
  emphasis,
}: {
  readonly layout: ChartLayout;
  readonly faded?: ReadonlySet<string> | undefined;
  readonly emphasis?: ReadonlySet<string> | undefined;
}) {
  const on = (edge: ChartEdge) => emphasis?.has(`${edge.from}>${edge.to}`) ?? false;
  const edges = emphasis ? [...layout.edges].sort((a, b) => Number(on(a)) - Number(on(b))) : layout.edges;
  return (
    <svg
      aria-hidden="true"
      width={layout.width}
      height={layout.height}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      {edges.map((edge) => (
        <path
          key={`${edge.from}>${edge.to}`}
          d={edgePath(edge.points)}
          fill="none"
          strokeWidth={on(edge) ? 2.25 : 1.5}
          strokeLinecap="round"
          className={cx(
            'transition-opacity duration-200 motion-reduce:transition-none',
            on(edge) ? 'stroke-ink-2' : 'stroke-line-2',
            (faded?.has(edge.to) || (emphasis && !on(edge))) && 'opacity-30',
          )}
        />
      ))}
    </svg>
  );
}
