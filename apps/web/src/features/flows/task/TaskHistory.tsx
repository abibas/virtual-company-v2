import type { TaskEventKind } from '@mwc/shared/enums';
import type { TaskEvent } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { formatDateTime } from '../../../components/data/format.ts';
import { ago } from '../../notifications/NotificationList.tsx';
import { Face } from '../Face.tsx';

/** What each move says after its actor's name, and its dot's colour. */
const WORDS: Readonly<Record<TaskEventKind, readonly [string, string]>> = {
  created: ['created it', 'bg-blue'],
  entered: ['entered', 'bg-faint'],
  started: ['started it', 'bg-blue'],
  handed_on: ['handed it on', 'bg-blue'],
  passed: ['passed it', 'bg-input'],
  sent_back: ['sent it back', 'bg-blocked'],
  escalated: ['escalated it', 'bg-blocked'],
  signed_off: ['approved it', 'bg-review'],
  routed: ['routed it', 'bg-ink-2'],
  retried: ['retried it', 'bg-ink-2'],
  done: ['done', 'bg-done'],
  cancelled: ['cancelled it', 'bg-pending'],
  edited: ['edited', 'bg-faint'],
  blocked: ['blocked', 'bg-blocked'],
  turn_ended: ['ended its turn', 'bg-pending'],
};

/** The line of one move: who did what, from and to which step. */
function lineOf(event: TaskEvent): string {
  const [verb] = WORDS[event.kind];
  if (event.kind === 'entered')
    return `Entered ${event.to?.name ?? 'a step'}${event.round ? ` · round ${event.round}` : ''}`;
  if (event.kind === 'done') return 'Done';
  if (event.kind === 'started' && event.actor === null)
    return `Started by itself${event.to ? ` at ${event.to.name}` : ''}`;
  if (event.kind === 'blocked')
    return `Blocked${event.to ? ` at ${event.to.name}` : ''}${event.reason ? `: ${event.reason}` : ''}`;
  if (event.kind === 'turn_ended')
    return `The turn ended${event.to ? ` at ${event.to.name}` : ''} without a hand-off`;
  if (event.kind === 'escalated') {
    return `${event.actor?.name ?? 'Someone'} sent it back over ${event.from?.name ?? 'the step'}'s limit: escalated to the Lead`;
  }
  const fields =
    event.kind === 'edited' && Array.isArray(event.details.fields)
      ? ` the ${event.details.fields.join(', ')}`
      : '';
  const where =
    event.from && event.to
      ? ` · ${event.from.name} → ${event.to.name}`
      : event.to
        ? ` · at ${event.to.name}`
        : event.from
          ? ` · at ${event.from.name}`
          : '';
  return `${event.actor?.name ?? 'Someone'} ${verb}${fields}${where}`;
}

/**
 * A task's history, oldest first, as a compact timeline: each move's dot in its colour, who did what (with their face:
 * an agent's icon when an agent moved it with its tools, S6a) from and to which step, its reason, and when. A step
 * entered after a move is a quieter line under it.
 */
export function TaskHistory({
  history,
  nodes,
}: {
  readonly history: readonly TaskEvent[];
  readonly nodes: ReadonlyMap<string, ChartNode>;
}) {
  return (
    <ol className="relative flex flex-col gap-1.5 before:absolute before:top-2 before:bottom-2 before:left-[4px] before:w-px before:bg-line-2">
      {history.map((event) => {
        const quiet = event.kind === 'entered' || event.kind === 'edited';
        return (
          <li key={event.id} className="relative flex gap-2.5">
            <span
              aria-hidden="true"
              className={cx(
                'relative mt-[5px] size-[9px] shrink-0 rounded-full ring-2 ring-surface',
                WORDS[event.kind][1],
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2">
                <span
                  className={cx(
                    'min-w-0 flex-1 leading-snug',
                    quiet ? 'text-xs text-dim' : 'text-sm font-medium text-ink',
                  )}
                >
                  {event.actor && !quiet && (
                    <Face who={event.actor} nodes={nodes} className="mr-1.5 inline-flex align-middle" />
                  )}
                  {lineOf(event)}
                </span>
                <time
                  dateTime={event.at}
                  title={formatDateTime(event.at)}
                  className="shrink-0 text-2xs text-faint"
                >
                  {ago(event.at)}
                </time>
              </p>
              {event.reason && (
                <p className="mt-0.5 border-l-2 border-line-2 pl-2 text-xs whitespace-pre-wrap text-ink-2">
                  {event.reason}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
