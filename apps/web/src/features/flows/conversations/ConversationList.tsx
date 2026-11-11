import type { ChartNode } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { formatDateTime } from '../../../components/data/format.ts';
import { ago } from '../../notifications/NotificationList.tsx';
import { Face } from '../Face.tsx';
import { LiveDot } from './LiveDot.tsx';
import { conversationLook, type RoundSpan, roundWords, type TaskConversation } from './model.ts';

/** A state's dot colour, by its tone. */
const DOT: Readonly<Record<string, string>> = {
  blue: 'bg-blue',
  pending: 'bg-pending',
  done: 'bg-done',
  input: 'bg-input',
  failed: 'bg-failed',
};

/** One conversation as a chip: the agent's face, the step and its rounds, the state and its last activity. */
function Chip({
  conversation,
  span,
  nodes,
  open,
  onOpen,
}: {
  readonly conversation: TaskConversation;
  readonly span: RoundSpan | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly open: boolean;
  readonly onOpen: () => void;
}) {
  const look = conversationLook(conversation);
  const at = conversation.lastTurn?.at ?? conversation.createdAt;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={open}
      title={conversation.title ?? undefined}
      className={cx(
        'inline-flex h-8 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-1 text-xs transition-colors',
        open
          ? 'bg-blue-soft text-ink ring-1 ring-blue/40 ring-inset'
          : 'bg-surface-2 text-ink-2 hover:bg-surface-3',
      )}
    >
      {conversation.agent && <Face who={conversation.agent} nodes={nodes} size="xs" />}
      <span className="truncate font-semibold">{conversation.step.name}</span>
      <span className="text-dim">{span ? roundWords(span) : `Round ${conversation.round}`}</span>
      <span className="inline-flex items-center gap-1 text-dim">
        <LiveDot live={look.live} className={DOT[look.tone] ?? 'bg-pending'} />
        {look.label}
      </span>
      <time dateTime={at} title={formatDateTime(at)} className="text-faint">
        {ago(at)}
      </time>
    </button>
  );
}

/** The task's conversations as a row of chips (wrapping), the open one marked. */
export function ConversationList({
  conversations,
  spans,
  nodes,
  openId,
  onOpen,
}: {
  readonly conversations: readonly TaskConversation[];
  readonly spans: ReadonlyMap<string, RoundSpan>;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly openId: string | undefined;
  readonly onOpen: (chatId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {conversations.map((c) => (
        <Chip
          key={c.chatId}
          conversation={c}
          span={spans.get(c.chatId)}
          nodes={nodes}
          open={c.chatId === openId}
          onOpen={() => onOpen(c.chatId)}
        />
      ))}
    </div>
  );
}
