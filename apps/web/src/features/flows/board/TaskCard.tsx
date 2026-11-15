import { BellRing, Files, Hourglass, ListStart } from 'lucide-react';
import type { DragEvent } from 'react';
import type { BoardCard } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { ago, formatDateTime } from '../../../components/data/format.ts';
import { Badge, type Tone } from '../../../components/ui/Badge.tsx';
import { LiveDot } from '../conversations/LiveDot.tsx';
import { Face } from '../Face.tsx';
import { PRIORITY, stepStateLook, TASK_STATE } from '../words.ts';
import type { QueueEdge } from './use-queue-order.ts';

/** The step state's pill: a pulsing dot while the agent's turn runs, and why it is blocked as its tooltip. */
function StatePill({
  card,
  look,
}: {
  readonly card: BoardCard;
  readonly look: { label: string; tone: Tone };
}) {
  const working = card.stepState === 'working';
  return (
    <span title={card.blockedReason ?? undefined} className="inline-flex min-w-0">
      <Badge tone={look.tone} size="sm" dot={!working}>
        {working && <LiveDot live className="bg-blue" />}
        {look.label}
      </Badge>
    </span>
  );
}

/**
 * What a queued task waits for (T-39): "waits for T-5, T-6", a closed one struck through; Autotake skips it until each
 * is done or cancelled.
 */
function WaitsFor({ waits }: { readonly waits: BoardCard['waitsFor'] }) {
  const open = waits.filter((wait) => !wait.closed).map((wait) => wait.key);
  const title =
    open.length === 0
      ? 'Everything it waits for is done: Autotake may take it'
      : `Autotake takes it once ${open.join(', ')} ${open.length === 1 ? 'is' : 'are'} done or cancelled`;
  return (
    <span title={title} className="flex flex-wrap items-center gap-x-1 text-2xs text-dim">
      <Hourglass size={11} aria-hidden="true" />
      waits for
      {waits.map((wait, index) => (
        <span key={wait.key} className={cx('font-mono font-semibold', wait.closed ? 'text-faint line-through' : 'text-ink')}>
          {wait.key}
          {index < waits.length - 1 ? ',' : ''}
        </span>
      ))}
    </span>
  );
}

/**
 * A task on the board: its key, its priority (unless normal), "auto" in Queued when marked Autotake (T-34), its
 * artifacts (a files icon and the count) and when it last moved; its title; its step state (pulsing while a turn runs, why it is blocked on hover), its round from the
 * second on, "Lead notified" once its agent Lead was woken about it as it stands (S6c), and who has it; a red Cancelled
 * in the Done column when it was cancelled; in Queued what it waits for (T-39, a closed one struck through). It opens the
 * task's page, and the Lead's people drag it to a step, or up and down Queued (a line shows where it would go).
 */
export function TaskCard({
  card,
  href,
  nodes,
  me,
  draggable,
  queued = false,
  moving = false,
  onDragStart,
  onDragEnd,
  dropEdge,
  onDragOver,
  onDrop,
}: {
  readonly card: BoardCard;
  readonly href: string;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The signed-in person's principal: a task waiting for them "Needs you". */
  readonly me: string | undefined;
  readonly draggable: boolean;
  /** It sits in Queued: a task marked Autotake says "auto" (the flow's Autotake takes it by itself). */
  readonly queued?: boolean;
  /** Its move is being saved. */
  readonly moving?: boolean;
  readonly onDragStart?: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd?: () => void;
  /** Reordering Queued (T-39): the side a dragged card would go to, and the drag over and drop on this card. */
  readonly dropEdge?: QueueEdge | undefined;
  readonly onDragOver?: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop?: (event: DragEvent<HTMLElement>) => void;
}) {
  const state = card.stepState ? stepStateLook(card.stepState, card.assignee?.principalId === me) : undefined;
  return (
    <Link
      to={href}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : (event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label={`${card.key}: ${card.title}`}
      className={cx(
        'relative flex flex-col gap-1.5 rounded-xl bg-surface p-2.5 shadow-card ring-1 ring-line transition-[box-shadow,opacity] hover:ring-line-2 focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none',
        draggable && 'cursor-grab active:cursor-grabbing',
        moving && 'opacity-60',
      )}
    >
      {dropEdge && (
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-blue',
            dropEdge === 'before' ? '-top-[5px]' : '-bottom-[5px]',
          )}
        />
      )}
      <span className="flex items-center gap-1.5 text-2xs">
        <span className="font-mono font-bold text-dim">{card.key}</span>
        {card.priority !== 'normal' && (
          <Badge tone={PRIORITY[card.priority].tone} size="sm">
            {PRIORITY[card.priority].label}
          </Badge>
        )}
        {queued && card.autoTake && (
          <span
            title="Autotake: the flow takes it from Queued by itself"
            className="inline-flex items-center gap-0.5 font-semibold text-blue"
          >
            <ListStart size={11} aria-hidden="true" />
            auto
          </span>
        )}
        {card.artifacts > 0 && (
          <span
            title={`${card.artifacts} ${card.artifacts === 1 ? 'artifact' : 'artifacts'}`}
            className="ml-auto inline-flex items-center gap-0.5 font-semibold text-dim tabular"
          >
            <Files size={11} aria-hidden="true" />
            {card.artifacts}
          </span>
        )}
        <time
          dateTime={card.updatedAt}
          title={formatDateTime(card.updatedAt)}
          className={cx('text-faint', card.artifacts === 0 && 'ml-auto')}
        >
          {ago(card.updatedAt)}
        </time>
      </span>
      <span className="line-clamp-2 text-sm leading-snug font-semibold text-ink">{card.title}</span>
      {queued && card.waitsFor.length > 0 && <WaitsFor waits={card.waitsFor} />}
      {card.cancelled && (
        <span className="flex">
          <Badge tone={TASK_STATE.cancelled.tone} size="sm" dot>
            {TASK_STATE.cancelled.label}
          </Badge>
        </span>
      )}
      {(state || card.assignee) && (
        <span className="flex min-w-0 items-center gap-1.5">
          {state && <StatePill card={card} look={state} />}
          {card.round !== null && card.round > 1 && (
            <span className="text-2xs font-semibold text-dim">round {card.round}</span>
          )}
          {card.leadNotifiedAt && (
            <span
              title={`The Lead was told ${ago(card.leadNotifiedAt)} (${formatDateTime(card.leadNotifiedAt)})`}
              className="inline-flex items-center gap-0.5 text-2xs font-semibold text-blue"
            >
              <BellRing size={11} aria-hidden="true" />
              Lead notified
            </span>
          )}
          {card.assignee && (
            <span title={card.assignee.name} className="ml-auto">
              <Face who={card.assignee} nodes={nodes} link="nested" />
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
