import { MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { type ChatCalls, chatCalls } from '../../../api/chats.ts';
import { useApi } from '../../../api/context.ts';
import { useAgentPlacement } from '../../../api/org.ts';
import type { ChartNode, Chat } from '../../../api/types.ts';
import { useEarlierConversations } from '../../../api/use-chat-earlier.ts';
import { type ChatLive, type StreamState, useChatLive } from '../../../api/use-chat-live.ts';
import { Link } from '../../../app/router.tsx';
import { ErrorBlock, LoadingBlock } from '../../../components/data/LoadState.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { Composer } from '../../chats/Composer.tsx';
import { QueuedMessages } from '../../chats/delivery/QueuedMessages.tsx';
import { HEADER_CONTROL } from '../../chats/header/ChatBar.tsx';
import { OpenInClaudeCode } from '../../chats/header/OpenInClaudeCode.tsx';
import { asking, closedWhy, queueActions, queueView } from '../../chats/OpenChat.tsx';
import { ChatThread } from '../../chats/thread/ChatThread.tsx';
import { rememberSent } from '../../chats/thread/question/use-question-draft.ts';
import type { RoundSpan, TaskConversation } from './model.ts';
import { ThreadFrame } from './ThreadFrame.tsx';

const STREAM_WORDS: Readonly<Partial<Record<StreamState, string>>> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  gone: 'Gone',
};

/** Calls `onSettled` once the running turn it saw ends (the task's state and artifacts change then). */
function useSettled(runningId: string | undefined, onSettled: () => void) {
  const seen = useRef(runningId);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== runningId) settled.current();
    seen.current = runningId;
  }, [runningId]);
}

/** The live thread and its composer: a reply, an answer, Stop and the waiting messages, each shown at once. */
function LiveBody({
  calls,
  live,
  chat,
  agentName,
  closed,
  onChanged,
}: {
  readonly calls: ChatCalls;
  readonly live: ChatLive;
  readonly chat: Chat;
  readonly agentName: string;
  readonly closed: string | undefined;
  readonly onChanged: () => void;
}) {
  const folds = useEarlierConversations(calls, chat.id);
  const view = queueView(live, chat);
  return (
    <>
      <ChatThread
        turns={view.thread}
        agentName={agentName}
        chatInit={live.detail.data?.init ?? undefined}
        answering={{
          closed,
          answer: async (questionId, answers) => {
            const turn = await calls.answer(chat.id, { questionId, answers });
            rememberSent(questionId, turn.id, answers);
            live.putTurn(turn);
          },
        }}
        history={{ live: live.earlier, folds }}
      />
      <Composer
        running={view.running !== undefined}
        choices={view.choices}
        disabled={closed}
        placeholder={
          asking(view.thread) ? 'Answer above, or write your answer here' : 'Reply in this conversation'
        }
        onSend={async (prompt, delivery) => {
          live.putTurn(await calls.send(chat.id, prompt, delivery));
          onChanged();
        }}
        onStop={async () => {
          if (view.running) live.putTurn(await calls.stop(chat.id, view.running.id));
        }}
        queue={<QueuedMessages queue={view.queue} actions={queueActions(calls, live, chat, view.running)} />}
      />
    </>
  );
}

export interface TaskThreadProps {
  readonly companyId: string;
  readonly conversation: TaskConversation;
  readonly span: RoundSpan | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The step's agent (its placement: where "Open in Claude Code" resumes). */
  readonly agentId: string | undefined;
  /** Admins and owners write in an agent's chats. */
  readonly admin: boolean;
  /** The chat page with this conversation open. */
  readonly chatHref: string | undefined;
  /** A message was sent (the task is worked on again) or a turn ended: read the task again. */
  readonly onChanged: () => void;
}

/**
 * A task's conversation, live, on its page (S5.3b): the chat's stream and thread (tool calls, subagents, copy) as on
 * the chat page, its composer (a reply continues the conversation, and the server sets the task back to working),
 * Stop, the waiting messages, "Open as chat" and "Open in Claude Code".
 */
export function TaskThread(props: TaskThreadProps) {
  const { companyId, conversation, admin } = props;
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const live = useChatLive(companyId, conversation.chatId);
  const placement = useAgentPlacement(companyId, props.agentId).data;
  const chat = live.chat;
  const running = live.turns.find((turn) => turn.status === 'running');
  useSettled(running?.id, props.onChanged);
  const words = STREAM_WORDS[live.stream];
  const frame = { conversation, span: props.span, nodes: props.nodes };
  const openAsChat = props.chatHref && (
    <Link to={props.chatHref} className={HEADER_CONTROL}>
      <MessagesSquare size={13} aria-hidden="true" />
      Open as chat
    </Link>
  );
  if (chat === undefined)
    return (
      <ThreadFrame {...frame} controls={openAsChat}>
        {live.detail.error !== undefined ? (
          <ErrorBlock error={live.detail.error} onRetry={live.detail.reload} />
        ) : (
          <LoadingBlock label="Opening the conversation…" />
        )}
      </ThreadFrame>
    );
  const closed = closedWhy(chat, admin, placement);
  const sessionCwd = live.detail.data?.init?.cwd;
  const controls = (
    <>
      {openAsChat}
      {admin && (
        <OpenInClaudeCode companyId={companyId} chat={chat} placement={placement} sessionCwd={sessionCwd} />
      )}
    </>
  );
  const status = words && (
    <Badge size="sm" tone={live.stream === 'gone' ? 'failed' : 'pending'} dot className="shrink-0">
      {words}
    </Badge>
  );
  return (
    <ThreadFrame {...frame} status={status} controls={controls}>
      <LiveBody
        calls={calls}
        live={live}
        chat={chat}
        agentName={conversation.agent?.name ?? 'the agent'}
        closed={closed}
        onChanged={props.onChanged}
      />
    </ThreadFrame>
  );
}
