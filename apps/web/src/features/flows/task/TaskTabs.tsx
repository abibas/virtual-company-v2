import { useState } from 'react';
import type { Flow, TaskDetail } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { SegmentedControl, type SegmentOption } from '../../../components/forms/Segmented.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { TaskDecisions } from '../../decisions/TaskDecisions.tsx';
import { TaskConversations } from '../conversations/TaskConversations.tsx';
import { TaskStory } from '../story/TaskStory.tsx';
import type { TaskRuns } from './runs.ts';
import { TaskDescription } from './TaskDescription.tsx';
import { TaskHistory } from './TaskHistory.tsx';

type Tab = 'story' | 'conversations' | 'decisions' | 'description' | 'log';

/**
 * The page's main column: Story (its rounds), Conversations (the open one's thread inline), Decisions (what its agents
 * recorded, for members and above, 2026-11-14), Description (Markdown, with Edit) and Log (every history row). A step's
 * "conversation" link in the story, and a decision's, opens the Conversations tab on it.
 */
export function TaskTabs({
  task,
  flow,
  nodes,
  runs,
  editable,
  onDescription,
  me,
  decisions,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly runs: TaskRuns;
  readonly editable: boolean;
  readonly onDescription: (next: string) => Promise<unknown>;
  /** The viewer's principal on the chart. */
  readonly me: string | undefined;
  /** Its agents' recorded decisions, for members and above: the company they are read from. */
  readonly decisions?: { readonly companyId: string } | undefined;
}) {
  const [tab, setTab] = useState<Tab>('story');
  const [chat, setChat] = useState<string>();
  const options: SegmentOption<Tab>[] = [
    { value: 'story', label: 'Story' },
    ...(task.conversations.length > 0
      ? [{ value: 'conversations' as const, label: 'Conversations', note: String(task.conversations.length) }]
      : []),
    ...(decisions && task.conversations.length > 0
      ? [{ value: 'decisions' as const, label: 'Decisions' }]
      : []),
    { value: 'description', label: 'Description' },
    { value: 'log', label: 'Log', note: String(task.history.length) },
  ];
  const openChat = (chatId: string) => {
    setChat(chatId);
    setTab('conversations');
  };
  return (
    <section aria-label="The task's story" className="flex min-w-0 flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <SegmentedControl options={options} value={tab} onChange={setTab} label="View" size="sm" />
      </div>
      {tab === 'conversations' ? (
        <TaskConversations
          task={task}
          flow={flow}
          nodes={nodes}
          thread={runs.thread}
          chosen={chat}
          onChoose={setChat}
        />
      ) : (
        <Card padding="sm">
          {tab === 'story' && (
            <TaskStory task={task} flow={flow} nodes={nodes} runs={runs} onConversation={openChat} me={me} />
          )}
          {tab === 'decisions' && decisions && (
            <TaskDecisions
              companyId={decisions.companyId}
              taskId={task.id}
              nodes={nodes}
              onConversation={openChat}
            />
          )}
          {tab === 'description' && (
            <TaskDescription value={task.description} editable={editable} onSave={onDescription} />
          )}
          {tab === 'log' && <TaskHistory history={task.history} nodes={nodes} />}
        </Card>
      )}
    </section>
  );
}
