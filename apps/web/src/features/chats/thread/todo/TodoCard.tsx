import { Check, ListChecks } from 'lucide-react';
import type { TurnEvent } from '../../../../api/types.ts';
import { cx } from '../../../../components/cx.ts';

type TodoItem = Extract<TurnEvent, { type: 'todo' }>['items'][number];

/** An item's mark: an empty ring, a blue dot while in progress (pulsing while the turn runs), a filled check once done. */
function ItemMark({ status, live }: { readonly status: TodoItem['status']; readonly live: boolean }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-done text-white">
        <Check size={9} strokeWidth={3.5} aria-hidden="true" />
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full ring-[1.5px] ring-blue ring-inset">
        <span className={cx('size-1.5 rounded-full bg-blue', live && 'motion-safe:animate-pulse')} />
      </span>
    );
  }
  return <span className="mt-0.5 size-3.5 shrink-0 rounded-full ring-[1.5px] ring-line-2 ring-inset" />;
}

const STATUS_WORDS: Readonly<Record<TodoItem['status'], string>> = {
  pending: 'to do',
  in_progress: 'in progress',
  completed: 'done',
};

/**
 * The agent's to-do list (S5.2): a card with its progress ("3 / 7" and a bar), each item to do, in progress
 * (highlighted) or done (checked and struck). Pinned above a running turn's status, kept in the finished turn.
 */
export function TodoCard({ items, live }: { readonly items: readonly TodoItem[]; readonly live: boolean }) {
  const done = items.filter((item) => item.status === 'completed').length;
  const complete = items.length > 0 && done === items.length;
  return (
    <section
      aria-label="To-dos"
      className="grid w-full max-w-xl gap-2 rounded-xl bg-surface px-3.5 py-3 shadow-card ring-1 ring-line ring-inset"
    >
      <header className="flex items-center gap-2 text-xs">
        <ListChecks size={14} aria-hidden="true" className={complete ? 'text-done' : 'text-blue'} />
        <h4 className="font-semibold text-ink">To-dos</h4>
        <span className="ml-auto font-semibold text-ink-2 tabular">
          {done} / {items.length}
        </span>
      </header>
      <div
        role="progressbar"
        aria-label="To-dos done"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
        className="h-1 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
            complete ? 'bg-done' : 'bg-blue',
          )}
          style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
        />
      </div>
      <ol className="scroll-quiet grid max-h-72 gap-1.5 overflow-y-auto pt-0.5">
        {items.map((item, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: an item's place in the list is its identity.
            key={index}
            className={cx(
              'flex min-w-0 items-start gap-2 text-xs leading-snug',
              item.status === 'completed' && 'text-faint line-through decoration-line-2',
              item.status === 'in_progress' && 'font-semibold text-ink',
              item.status === 'pending' && 'text-ink-2',
            )}
          >
            <ItemMark status={item.status} live={live} />
            <span className="min-w-0 break-words">
              {item.text}
              <span className="sr-only"> ({STATUS_WORDS[item.status]})</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
