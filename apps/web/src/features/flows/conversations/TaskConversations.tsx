import type { Flow, TaskDetail } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Card } from '../../../components/ui/Card.tsx';
import type { TaskRuns } from '../task/runs.ts';
import { ConversationList } from './ConversationList.tsx';
import { firstOpen, inStepOrder, roundSpans } from './model.ts';

/**
 * The task's conversations (S5.3b; the page's Conversations tab): one chip per conversation (a Keep step's one, a Fresh
 * step's one per round), in the flow's order, and the open one's thread inline under them; the one chosen (from a chip
 * or a step of the story), else the current step's latest. Nothing shows before the first conversation.
 */
export function TaskConversations({
  task,
  flow,
  nodes,
  thread,
  chosen,
  onChoose,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly thread: TaskRuns['thread'];
  /** The conversation chosen on the page, if any. */
  readonly chosen: string | undefined;
  readonly onChoose: (chatId: string) => void;
}) {
  if (task.conversations.length === 0) return null;
  const spans = roundSpans(task);
  const list = inStepOrder(task, flow?.steps.map((step) => step.id) ?? []);
  const openId = list.some((c) => c.chatId === chosen) ? chosen : firstOpen(task);
  const open = list.find((c) => c.chatId === openId);
  return (
    <Card as="section" padding="none" aria-label="Conversations" className="overflow-hidden">
      <div className="px-3 py-2.5">
        <ConversationList
          conversations={list}
          spans={spans}
          nodes={nodes}
          openId={openId}
          onOpen={onChoose}
        />
      </div>
      {open && thread(open, spans.get(open.chatId))}
    </Card>
  );
}
