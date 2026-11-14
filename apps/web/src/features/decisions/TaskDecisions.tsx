import type { ChartNode } from '../../api/types.ts';
import { turnAnchor } from '../agents/links.ts';
import { DecisionsList } from './DecisionsList.tsx';

/**
 * The decisions a task's agents recorded in its steps' turns (2026-11-14), its Decisions tab: whose each is, and a
 * link that opens its conversation scrolled to the turn.
 */
export function TaskDecisions({
  companyId,
  taskId,
  nodes,
  onConversation,
}: {
  readonly companyId: string;
  readonly taskId: string;
  /** The chart's nodes, for the agents' names. */
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** Opens one of the task's conversations. */
  readonly onConversation: (chatId: string) => void;
}) {
  const names = new Map(
    [...nodes.values()].flatMap((node) =>
      node.kind === 'agent' ? [[node.agent.agentId, node.agent.name]] : [],
    ),
  );
  return (
    <DecisionsList
      companyId={companyId}
      query={{ task: taskId }}
      agentName={(agentId) => names.get(agentId)}
      where={(decision) => (
        <button
          type="button"
          onClick={() => {
            window.history.replaceState(window.history.state, '', `#${turnAnchor(decision.turnId)}`);
            onConversation(decision.chatId);
          }}
          className="cursor-pointer rounded-xs font-semibold text-blue hover:underline"
        >
          In its conversation
        </button>
      )}
    />
  );
}
