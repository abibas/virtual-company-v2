import type { DragEvent } from 'react';
import type { BoardCard } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { formatDateTime } from '../../../components/data/format.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { ago } from '../../notifications/NotificationList.tsx';
import { Face } from '../Face.tsx';
import { PRIORITY, stepStateLook } from '../words.ts';

/**
 * A task on the board: its key, its priority (unless normal) and when it last moved; its title; its step state, its
 * round from the second on, and who has it. It opens the task's page, and the Lead's people drag it to a step.
 */
export function TaskCard({
  card,
  href,
  nodes,
  me,
  draggable,
  moving = false,
  onDragStart,
  onDragEnd,
}: {
  readonly card: BoardCard;
  readonly href: string;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The signed-in person's principal: a task waiting for them "Needs you". */
  readonly me: string | undefined;
  readonly draggable: boolean;
  /** Its move is being saved. */
  readonly moving?: boolean;
  readonly onDragStart?: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd?: () => void;
}) {
  const state = card.stepState ? stepStateLook(card.stepState, card.assignee?.principalId === me) : undefined;
  return (
    <Link
      to={href}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : (event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      aria-label={`${card.key}: ${card.title}`}
      className={cx(
        'flex flex-col gap-1.5 rounded-xl bg-surface p-2.5 shadow-card ring-1 ring-line transition-[box-shadow,opacity] hover:ring-line-2 focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none',
        draggable && 'cursor-grab active:cursor-grabbing',
        moving && 'opacity-60',
      )}
    >
      <span className="flex items-center gap-1.5 text-2xs">
        <span className="font-mono font-bold text-dim">{card.key}</span>
        {card.priority !== 'normal' && (
          <Badge tone={PRIORITY[card.priority].tone} size="sm">
            {PRIORITY[card.priority].label}
          </Badge>
        )}
        <time dateTime={card.updatedAt} title={formatDateTime(card.updatedAt)} className="ml-auto text-faint">
          {ago(card.updatedAt)}
        </time>
      </span>
      <span className="line-clamp-2 text-sm leading-snug font-semibold text-ink">{card.title}</span>
      {(state || card.assignee) && (
        <span className="flex min-w-0 items-center gap-1.5">
          {state && (
            <Badge tone={state.tone} size="sm" dot>
              {state.label}
            </Badge>
          )}
          {card.round !== null && card.round > 1 && (
            <span className="text-2xs font-semibold text-dim">round {card.round}</span>
          )}
          {card.assignee && (
            <span title={card.assignee.name} className="ml-auto">
              <Face who={card.assignee} nodes={nodes} />
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
