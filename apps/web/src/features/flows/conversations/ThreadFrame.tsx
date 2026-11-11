import type { ReactNode } from 'react';
import type { ChartNode } from '../../../api/types.ts';
import { Face } from '../Face.tsx';
import { type RoundSpan, roundWords, type TaskConversation } from './model.ts';

/**
 * The open conversation on the task's page: a header row (the agent's face, the step, its rounds and the agent; the
 * stream's state; Open as chat and Open in Claude Code on the right) over a fixed-height body that holds the live
 * thread and its composer, so the page itself stays short.
 */
export function ThreadFrame({
  conversation,
  span,
  nodes,
  status,
  controls,
  children,
}: {
  readonly conversation: TaskConversation;
  readonly span: RoundSpan | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The stream's state while it is not live ("Reconnecting…"). */
  readonly status?: ReactNode;
  readonly controls?: ReactNode;
  readonly children: ReactNode;
}) {
  const rounds = span ? roundWords(span) : `Round ${conversation.round}`;
  return (
    <div className="border-t border-line font-reading">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {conversation.agent && <Face who={conversation.agent} nodes={nodes} size="sm" />}
          <span className="truncate font-semibold text-ink">{conversation.step.name}</span>
          <span className="shrink-0 text-dim">· {rounds}</span>
          {conversation.agent && (
            <span className="hidden truncate text-dim sm:inline">· {conversation.agent.name}</span>
          )}
          {status}
        </div>
        {controls && <div className="flex shrink-0 items-center gap-1.5">{controls}</div>}
      </div>
      <div className="flex max-h-[min(72dvh,40rem)] min-h-56 flex-col border-t border-line">{children}</div>
    </div>
  );
}
