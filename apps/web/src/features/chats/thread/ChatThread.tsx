import { ArrowDown, MessagesSquare } from 'lucide-react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import type { RunsOn } from './status/WorkingStatus.tsx';
import { TurnView } from './TurnView.tsx';
import { useFollow } from './use-follow.ts';

function JumpToLatest({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-2 shadow-float ring-1 ring-line-2 ring-inset transition-colors hover:text-ink motion-safe:animate-roll-in"
    >
      <ArrowDown size={14} aria-hidden="true" />
      Jump to latest
    </button>
  );
}

/**
 * The chat's turns as a thread (S5.1c, S5.2), scrolled to the latest on open and following the live output while the
 * person is at the bottom (`useFollow`). Scrolling up to read stops the following and shows "Jump to latest".
 */
export function ChatThread({
  turns,
  agentName,
  chatInit,
}: {
  readonly turns: readonly ChatTurnWithEvents[];
  readonly agentName: string;
  readonly chatInit: RunsOn | undefined;
}) {
  const streaming = turns.some((turn) => turn.status === 'running');
  const follow = useFollow(turns, streaming);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={follow.box}
        onScroll={follow.onScroll}
        aria-busy={streaming || undefined}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6"
      >
        {turns.length === 0 ? (
          <EmptyState icon={MessagesSquare} tone="blue" title="No messages yet" size="sm">
            Write to {agentName} below. It answers from its folder on its machine, with its own tools.
          </EmptyState>
        ) : (
          <ol ref={follow.content} className="mx-auto grid max-w-3xl gap-7">
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} agentName={agentName} chatInit={chatInit} />
            ))}
          </ol>
        )}
      </div>
      {follow.away && <JumpToLatest onClick={follow.jump} />}
    </div>
  );
}
