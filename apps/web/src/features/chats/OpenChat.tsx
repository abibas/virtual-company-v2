import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ChatCalls, chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import type {
  AccessProfile,
  AgentDetail,
  AgentPlacement,
  Chat,
  ChatDelivery,
  ChatTurnWithEvents,
  QuestionAnswer,
} from '../../api/types.ts';
import { useEarlierConversations } from '../../api/use-chat-earlier.ts';
import { type ChatLive, useChatLive } from '../../api/use-chat-live.ts';
import { ErrorBlock, LoadingBlock } from '../../components/data/LoadState.tsx';
import { ChatTerminal } from './ChatTerminal.tsx';
import { Composer } from './Composer.tsx';
import { ChatContextMeter } from './context/ChatContextMeter.tsx';
import { chatRuns } from './context/context-state.ts';
import { AFTER_ONLY, deliveryChoices, splitQueue } from './delivery/delivery.ts';
import { type QueueActions, QueuedMessages } from './delivery/QueuedMessages.tsx';
import { ChatHeader, type ChatMode } from './header/ChatHeader.tsx';
import { ChatThread } from './thread/ChatThread.tsx';
import { questionOf } from './thread/question/question-model.ts';
import { rememberSent, sentAnswer } from './thread/question/use-question-draft.ts';

export interface OpenChatProps {
  readonly companyId: string;
  readonly chatId: string;
  readonly agent: AgentDetail;
  readonly placement: AgentPlacement | undefined;
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly admin: boolean;
  readonly owner: boolean;
  /** The chat changed in a way the list shows (its title after the first prompt, its profile). */
  readonly onChanged: () => void;
}

/** Why the composer is closed: an archived chat, a reader who is not an admin, an agent placed nowhere now. */
function closedWhy(chat: Chat, admin: boolean, placement: AgentPlacement | undefined): string | undefined {
  if (chat.archivedAt) return 'This chat is archived: it stays readable, and takes no new message.';
  if (!admin) return 'Admins and owners send messages to agents; you can read this chat.';
  if (placement === null)
    return "The agent doesn't run anywhere now: choose where it runs on its page first.";
  return undefined;
}

/** The agent moved to another machine since the chat began: its conversation is not there. */
function MovedNotice() {
  return (
    <p className="flex items-center gap-2 bg-input-soft px-4 py-2 text-xs text-ink md:px-5">
      <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-input" />
      The agent runs on another machine now, so this chat's conversation isn't there: start a new chat.
    </p>
  );
}

/** True while the chat's last turn asks the person something they have not answered. */
function asking(thread: readonly ChatTurnWithEvents[]): boolean {
  const last = thread.at(-1);
  const question = last && questionOf(last.events);
  return question !== undefined && !question.answered && sentAnswer(question.event.id) === undefined;
}

/** Send (with its delivery while a turn runs), Stop, an answer and a profile change, each shown at once. */
function chatActions(calls: ChatCalls, live: ChatLive, chat: Chat, onChanged: () => void) {
  const running = live.turns.find((turn) => turn.status === 'running');
  const first = live.turns.length === 0;
  return {
    running,
    send: async (prompt: string, delivery: ChatDelivery | undefined) => {
      live.putTurn(await calls.send(chat.id, prompt, delivery));
      if (first) onChanged();
    },
    stop: async () => {
      if (running) live.putTurn(await calls.stop(chat.id, running.id));
    },
    answer: async (questionId: string, answers: QuestionAnswer[]) => {
      const turn = await calls.answer(chat.id, { questionId, answers });
      rememberSent(questionId, turn.id, answers);
      live.putTurn(turn);
    },
    changeProfile: async (profileId: string | null) => {
      live.putChat(await calls.update(chat.id, { profileId }));
      onChanged();
    },
  };
}

/** Edit, Discard, Now and Interrupt on a waiting message (S5.2 step 6), each shown at once. */
function queueActions(calls: ChatCalls, live: ChatLive, chat: Chat, running: ChatTurnWithEvents | undefined) {
  const actions: QueueActions = {
    canNow: running !== undefined && deliveryChoices(chat.harness, running).some((c) => c.value === 'now'),
    running: running !== undefined,
    edit: async (turnId, prompt) => live.putTurn(await calls.edit(chat.id, turnId, prompt)),
    discard: async (turnId) => {
      await calls.discard(chat.id, turnId);
      live.dropTurn(turnId);
    },
    deliver: async (turnId, delivery) => live.putTurn(await calls.deliver(chat.id, turnId, delivery)),
  };
  return actions;
}

/** The thread's turns, the waiting messages in start order, the running turn and how a message may reach it now. */
function queueView(live: ChatLive, chat: Chat) {
  const { thread, queue } = splitQueue(live.turns);
  const running = live.turns.find((turn) => turn.status === 'running');
  const waiting = queue.length > 0 ? AFTER_ONLY : undefined;
  const choices = running ? deliveryChoices(chat.harness, running) : waiting;
  return { thread, queue, running, choices };
}

/**
 * The open chat (S5.1c): its header, then the live thread with the composer, or the terminal. The chat and its turns
 * come from `useChatLive` (the detail, then the stream); a prompt, a stop and a profile change show their answer at
 * once, before the stream says the same.
 */
export function OpenChat({ companyId, chatId, agent, placement, admin, owner, ...rest }: OpenChatProps) {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const live = useChatLive(companyId, chatId);
  const folds = useEarlierConversations(calls, chatId);
  const [mode, setMode] = useState<ChatMode>('chat');
  const chat = live.chat;
  if (chat === undefined) {
    const { error, reload } = live.detail;
    if (error !== undefined) return <ErrorBlock error={error} onRetry={reload} />;
    return <LoadingBlock label="Opening the chat…" />;
  }
  const actions = chatActions(calls, live, chat, rest.onChanged);
  const { thread, queue, running, choices } = queueView(live, chat);
  const sessionCwd = live.detail.data?.init?.cwd;
  const header = {
    companyId,
    agent,
    placement,
    chat,
    admin,
    owner,
    mode,
    profiles: rest.profiles,
    sessionCwd,
  };
  const closed = closedWhy(chat, admin, placement);
  return (
    <>
      <ChatHeader {...header} stream={live.stream} onMode={setMode} onProfile={actions.changeProfile} />
      {placement && placement.machineId !== chat.machineId && <MovedNotice />}
      {mode === 'terminal' && owner ? (
        <ChatTerminal companyId={companyId} chat={chat} />
      ) : (
        <>
          <ChatThread
            turns={thread}
            agentName={agent.name}
            chatInit={live.detail.data?.init ?? undefined}
            answering={{ answer: actions.answer, closed }}
            history={{ live: live.earlier, folds }}
          />
          <Composer
            running={running !== undefined}
            choices={choices}
            disabled={closed}
            placeholder={asking(thread) ? 'Answer above, or write your answer here' : `Message ${agent.name}`}
            onSend={actions.send}
            onStop={actions.stop}
            queue={<QueuedMessages queue={queue} actions={queueActions(calls, live, chat, running)} />}
            meter={
              <ChatContextMeter
                calls={calls}
                live={live}
                chat={chat}
                closed={closed}
                runs={chatRuns(chat, agent, rest.profiles)}
              />
            }
          />
        </>
      )}
    </>
  );
}
