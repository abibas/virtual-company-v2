import type { Board, FlowSummary } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import { Face } from '../Face.tsx';
import { KIND } from '../words.ts';

/** A count with its word, dimmed at zero. */
function Count({ n, label, tone }: { readonly n: number; readonly label: string; readonly tone?: string }) {
  return (
    <span className={cx('text-xs', n === 0 ? 'text-faint' : (tone ?? 'text-ink-2'))}>
      <span className="font-bold tabular">{n}</span> {label}
    </span>
  );
}

/** The steps as small chips in their kind's colour, each with the tasks at it; then Queued, Done and Escalated. */
function Columns({ board }: { readonly board: Board }) {
  const total = (kind: string) => board.columns.find((column) => column.kind === kind)?.total ?? 0;
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {board.columns.map((column) =>
          column.step ? (
            <span
              key={column.step.id}
              title={`${KIND[column.step.kind].label}: ${column.title}`}
              className={cx(
                'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold',
                KIND[column.step.kind].soft,
                KIND[column.step.kind].text,
              )}
            >
              <span className="truncate">{column.title}</span>
              <span className="font-bold tabular">{column.total}</span>
            </span>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Count n={total('queued')} label="queued" />
        <Count n={total('done')} label="done" tone="text-done" />
        <Count n={total('escalated')} label="escalated" tone="font-semibold text-blocked" />
      </div>
    </>
  );
}

/**
 * A team's flow on the Flows page: its Lead's face, its name and its Lead, its open tasks; its steps as coloured chips
 * with the tasks at each, and its Queued, Done and Escalated counts. The whole card opens the team's board.
 */
export function FlowCard({
  flow,
  board,
  nodes,
  href,
}: {
  readonly flow: FlowSummary;
  readonly board: Loaded<Board>;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly href: string;
}) {
  return (
    <Link
      to={href}
      className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-transparent transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-raised focus-visible:ring-blue focus-visible:outline-none"
    >
      <span className="flex items-center gap-3">
        <Face who={flow.lead} nodes={nodes} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-md font-bold text-ink">{flow.name}</span>
          <span className="block truncate text-xs text-dim">{flow.lead.name}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-lg leading-none font-extrabold text-ink tabular">{flow.openTasks}</span>
          <span className="text-2xs text-dim">open</span>
        </span>
      </span>
      {board.data ? <Columns board={board.data} /> : <Skeleton className="h-12" />}
    </Link>
  );
}
