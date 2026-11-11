import type { DragEvent, ReactNode } from 'react';
import type { BoardColumn as Column } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { Face } from '../Face.tsx';
import { KIND } from '../words.ts';

/** The colour of a column that is not a step's: Queued grey, Done green, Escalated orange. */
const OTHER: Readonly<Record<Exclude<Column['kind'], 'step'>, string>> = {
  queued: 'bg-pending',
  done: 'bg-done',
  escalated: 'bg-blocked',
};

/** Where a dragged card stands over this column: it may land here, it may not, or no card is dragged. */
export type DropLook = 'open' | 'closed' | undefined;

/**
 * One column of the board: a bar in its kind's colour (a step's: Work blue, Check amber, Sign-off violet), its name,
 * its count (Done: the shown of all) and a step's assignee; then its cards. While a card is dragged, a column it may
 * land on is outlined, the others dimmed.
 */
export function BoardColumn({
  column,
  nodes,
  drop,
  over,
  onDragOver,
  onDrop,
  children,
}: {
  readonly column: Column;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly drop: DropLook;
  /** The dragged card is over it now. */
  readonly over: boolean;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}) {
  const bar = column.step ? KIND[column.step.kind].solid : OTHER[column.kind as keyof typeof OTHER];
  const count =
    column.kind === 'done' && column.total > column.cards.length
      ? `${column.cards.length} of ${column.total}`
      : String(column.total);
  return (
    <section
      aria-label={`${column.title}, ${column.total}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cx(
        'flex max-w-80 min-w-56 flex-1 basis-0 flex-col gap-2 rounded-2xl bg-surface-2 p-2 ring-inset transition-[box-shadow,opacity]',
        drop === 'open' && (over ? 'ring-2 ring-blue' : 'ring-1 ring-blue/40'),
        drop === 'closed' && 'opacity-55',
      )}
    >
      <header className="relative flex h-10 items-center gap-2 overflow-hidden rounded-lg bg-surface px-2.5 pt-0.5 shadow-card">
        <span aria-hidden="true" className={cx('absolute inset-x-0 top-0 h-[3px]', bar)} />
        <span className="min-w-0 truncate text-sm font-bold text-ink" title={column.title}>
          {column.title}
        </span>
        {column.step && (
          <span className={cx('text-2xs font-semibold', KIND[column.step.kind].text)}>
            {KIND[column.step.kind].label}
          </span>
        )}
        <span className="text-xs font-semibold text-dim tabular">{count}</span>
        {column.step && (
          <span title={column.step.assignee.name} className="ml-auto">
            <Face who={column.step.assignee} nodes={nodes} />
          </span>
        )}
      </header>
      <div className="flex min-h-16 flex-col gap-2">{children}</div>
    </section>
  );
}
