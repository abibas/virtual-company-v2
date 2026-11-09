import { Eraser, FoldVertical, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChatTurnWithEvents, TurnEvent } from '../../../api/types.ts';
import { Spinner } from '../../../components/ui/Button.tsx';
import { tokens, turnErrorText } from '../chat-text.ts';
import type { TurnModel } from './model/parts.ts';

/** The thread's markers between turns (S5.2): a compaction (its own turn, or during one) and a Clear. */

type CompactEvent = Extract<TurnEvent, { type: 'compact' }>;

/** A centred line across the thread with a few words on it. */
function Marker({
  icon,
  children,
  live = false,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly live?: boolean;
}) {
  return (
    <div
      role={live ? 'status' : undefined}
      className="flex items-center gap-3 py-1 text-2xs text-dim before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
    >
      <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-semibold ring-1 ring-line ring-inset">
        {icon}
        <span className="min-w-0">{children}</span>
      </span>
    </div>
  );
}

/** "476k → 24k", or "from 476k" when the harness did not say the size after. */
function sizes(event: CompactEvent): string {
  return event.postTokens === null
    ? `from ${tokens(event.preTokens)}`
    : `${tokens(event.preTokens)} → ${tokens(event.postTokens)}`;
}

const FOLD = <FoldVertical size={12} aria-hidden="true" className="shrink-0 text-faint" />;

/** A compaction during a turn: Claude Code's own, near the end of the window. */
export function CompactedMarker({ event }: { readonly event: CompactEvent }) {
  const how = event.trigger === 'auto' ? ' automatically' : '';
  return (
    <Marker icon={FOLD}>
      Conversation compacted{how} · {sizes(event)}
    </Marker>
  );
}

/** A Compact turn: running, then the sizes once its `compact` event came; failed or stopped say so. */
export function CompactTurn({
  turn,
  model,
}: {
  readonly turn: ChatTurnWithEvents;
  readonly model: TurnModel;
}) {
  if (turn.status === 'queued' || turn.status === 'running') {
    return (
      <Marker live icon={<Spinner size={11} className="text-blue" />}>
        {turn.status === 'queued'
          ? 'Compacting the conversation once the machine is ready…'
          : 'Compacting the conversation…'}
      </Marker>
    );
  }
  if (turn.status === 'done') {
    return (
      <Marker icon={FOLD}>Conversation compacted{model.compact ? ` · ${sizes(model.compact)}` : ''}</Marker>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Marker icon={<TriangleAlert size={12} aria-hidden="true" className="shrink-0 text-input" />}>
        {turn.status === 'stopped' ? 'Compaction stopped' : "The conversation wasn't compacted"}
      </Marker>
      {model.error && turn.status === 'failed' && (
        <p role="alert" className="text-center text-2xs text-failed">
          {turnErrorText(model.error)}
        </p>
      )}
    </div>
  );
}

/** A Clear: the conversation starts fresh after it. */
export function ClearDivider() {
  return (
    <Marker icon={<Eraser size={12} aria-hidden="true" className="shrink-0 text-faint" />}>
      Context cleared · a fresh conversation starts here
    </Marker>
  );
}
