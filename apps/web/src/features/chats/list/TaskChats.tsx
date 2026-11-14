import { ListChecks } from 'lucide-react';
import type { ChatListItem } from '../../../api/types.ts';
import type { ChatDot } from '../chat-dots.ts';
import { useSteadyOrder } from './steady-order.ts';
import { TaskChatRow } from './TaskChatRow.tsx';

/**
 * "Tasks" (2026-11-14, T-19; docs/harness.md "Task conversations in the agent's chats"): under the agent's own chats,
 * apart from them, the conversations its task steps run in, live like the chats (the green dot while a turn waits or
 * runs, the live ones first), each opening as a chat with its way back to the task. No blue dot for activity not seen:
 * a step's end is the task's news, told by its flow and the inbox, and every ended step would show one. Nothing shows
 * before the agent's first task.
 */
export function TaskChats({
  chats,
  openId,
  hrefOf,
  dots,
}: {
  readonly chats: readonly ChatListItem[];
  readonly openId: string | undefined;
  readonly hrefOf: (chatId: string) => string;
  readonly dots?: ReadonlyMap<string, ChatDot> | undefined;
}) {
  const { shown, hold } = useSteadyOrder(chats);
  if (chats.length === 0) return null;
  return (
    <section aria-label="Tasks" className="grid gap-1 border-t border-line pt-2">
      <h3 className="flex items-center gap-1.5 px-1 py-1 text-xs font-semibold text-dim">
        <ListChecks size={13} aria-hidden="true" />
        Tasks
        <span className="font-normal text-faint">{chats.length}</span>
      </h3>
      <ul
        {...hold}
        className="scroll-quiet -mx-1 grid max-h-64 grid-cols-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-1"
      >
        {shown.map((chat) => (
          <TaskChatRow
            key={chat.id}
            chat={chat}
            open={chat.id === openId}
            dot={dots?.get(chat.id) === 'working' ? 'working' : undefined}
            href={hrefOf(chat.id)}
          />
        ))}
      </ul>
    </section>
  );
}
