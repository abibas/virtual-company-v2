import { useState } from 'react';
import type { Flow, TaskDetail } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Card } from '../../../components/ui/Card.tsx';
import type { TaskRuns } from '../task/runs.ts';
import { ConversationList } from './ConversationList.tsx';
import { firstOpen, inStepOrder, roundSpans } from './model.ts';

/**
 * The task's conversations (S5.3b): one chip per conversation (a Keep step's one, a Fresh step's one per round), in
 * the flow's order, and the open one's thread inline under them; the current step's latest opens first. Nothing shows
 * before the first conversation.
 */
export function TaskConversations({
  task,
  flow,
  nodes,
  thread,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly thread: TaskRuns['thread'];
}) {
  const [chosen, setChosen] = useState<string>();
  if (task.conversations.length === 0) return null;
  const spans = roundSpans(task);
  const list = inStepOrder(task, flow?.steps.map((step) => step.id) ?? []);
  const openId = list.some((c) => c.chatId === chosen) ? chosen : firstOpen(task);
  const open = list.find((c) => c.chatId === openId);
  return (
    <Card as="section" padding="none" aria-label="Conversations" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <h2 className="text-xs font-bold tracking-wide text-dim uppercase">Conversations</h2>
        <ConversationList
          conversations={list}
          spans={spans}
          nodes={nodes}
          openId={openId}
          onOpen={setChosen}
        />
      </div>
      {open && thread(open, spans.get(open.chatId))}
    </Card>
  );
}
