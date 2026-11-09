import { MessagesSquare } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { TurnView } from './TurnView.tsx';

/** How close to the bottom counts as reading the latest: the thread follows new output only then. */
const FOLLOW_PX = 96;

/**
 * The chat's turns as a thread (S5.1c), scrolled to the latest on open and following the live output while the person
 * is at the bottom; scrolling up to read stops the following until they come back down.
 */
export function ChatThread({
  turns,
  agentName,
}: {
  readonly turns: readonly ChatTurnWithEvents[];
  readonly agentName: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every change of the turns may move the bottom.
  useLayoutEffect(() => {
    const element = box.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [turns]);
  const onScroll = () => {
    const element = box.current;
    if (element)
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
  };
  return (
    <div
      ref={box}
      onScroll={onScroll}
      aria-busy={turns.some((turn) => turn.status === 'running') || undefined}
      className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5"
    >
      {turns.length === 0 ? (
        <EmptyState icon={MessagesSquare} tone="blue" title="No messages yet" size="sm">
          Write to {agentName} below. It answers from its folder on its machine, with its own tools.
        </EmptyState>
      ) : (
        <ol className="grid gap-6">
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} agentName={agentName} />
          ))}
        </ol>
      )}
    </div>
  );
}
