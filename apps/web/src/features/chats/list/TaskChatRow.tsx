import type { ChatListItem } from '../../../api/types.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { fromNow } from '../../../components/data/format.ts';
import type { ChatDot } from '../chat-dots.ts';
import { DotColumn, movedAt } from './ChatRow.tsx';

/**
 * One task's conversation in an agent's chat list (2026-11-14, T-19; docs/harness.md "Task conversations in the agent's
 * chats"): the dot's column as on every row (green and pulsing while its step's turn waits or runs), the task's key and
 * title, and under it the step, the rounds the conversation covers ("Develop · round 1", "Develop · rounds 1–3": one
 * thread kept across rounds, or one per round), where the task stands once it is no longer active, and when it last
 * moved. No Archive here: the task's page decides its conversations.
 */

type ChatTask = NonNullable<ChatListItem['forTask']>;

/** "round 2", "rounds 1–3". */
const roundsWords = ({ from, to }: ChatTask['rounds']) =>
  from === to ? `round ${from}` : `rounds ${from}–${to}`;

/** The task's state, said once it is no longer active. */
const STATE_WORDS: Readonly<Record<ChatTask['state'], string | undefined>> = {
  queued: 'queued',
  active: undefined,
  escalated: 'escalated',
  done: 'done',
  cancelled: 'cancelled',
};

/** The second line: the step and its rounds, the task's state, when it last moved. */
function stepLine(chat: ChatListItem, task: ChatTask): string {
  const state = STATE_WORDS[task.state];
  return [task.step, roundsWords(task.rounds), state, fromNow(movedAt(chat))].filter(Boolean).join(' · ');
}

export function TaskChatRow({
  chat,
  open,
  dot,
  href,
}: {
  readonly chat: ChatListItem;
  readonly open: boolean;
  readonly dot: ChatDot | undefined;
  readonly href: string;
}) {
  const task = chat.forTask;
  const name = task ? `${task.key} · ${task.title}` : (chat.title ?? 'Task conversation');
  return (
    <li className={cx('flex min-w-0 rounded-lg', open ? 'bg-surface-3' : 'hover:bg-surface-2')}>
      <Link
        to={href}
        aria-current={open ? 'page' : undefined}
        title={name}
        className="flex min-w-0 flex-1 gap-2 rounded-lg py-1.5 pr-2.5 pl-2 focus-visible:outline-2 focus-visible:outline-blue"
      >
        <DotColumn dot={dot} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cx('truncate text-sm font-medium', open ? 'text-ink' : 'text-ink-2')}>{name}</span>
          <span className="truncate text-2xs text-faint">
            {task ? stepLine(chat, task) : fromNow(movedAt(chat))}
          </span>
        </span>
      </Link>
    </li>
  );
}
