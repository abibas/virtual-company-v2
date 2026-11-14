import type { ChatCalls } from '../../api/chats.ts';
import type {
  AgentPlacement,
  Chat,
  ChatDelivery,
  ChatTurnWithEvents,
  QuestionAnswer,
} from '../../api/types.ts';
import type { ChatLive } from '../../api/use-chat-live.ts';
import { AFTER_ONLY, deliveryChoices, splitQueue, waitsForMachine } from './delivery/delivery.ts';
import type { QueueActions } from './delivery/QueuedMessages.tsx';
import { questionOf } from './thread/question/question-model.ts';
import { rememberSent, sentAnswer } from './thread/question/use-question-draft.ts';
import { lastTalk } from './thread/talks.ts';

/**
 * What an open chat does and shows besides its parts (the full chat, the rail's docked chat, a task's conversation): why
 * its composer is closed, whether its agent asks something, its sends, stops, answers and profile change, its waiting
 * messages' actions, and the thread split from the waiting messages.
 */

/**
 * Whether the reader may write in the chat (2026-11-14, docs/harness.md "Who is in a chat"): a chat belongs to its
 * people, so anyone in a message chat writes from the member role up (the server lets only its people open it); a
 * task's conversation and a team chat keep admins and owners.
 */
export const mayWrite = (chat: Pick<Chat, 'task' | 'flowId'>, admin: boolean, member: boolean): boolean =>
  admin || (member && chat.task === null && chat.flowId === null);

/**
 * Why the composer is closed: an owner who only looks on (2026-11-14), an archived chat, a reader who is not an admin,
 * an agent placed nowhere now.
 */
export function closedWhy(
  chat: Chat,
  admin: boolean,
  placement: AgentPlacement | undefined,
  looksOn = false,
): string | undefined {
  if (looksOn) return 'Owner view: you are reading this chat, not in it. Add yourself to write in it.';
  if (chat.archivedAt) return 'This chat is archived: it stays readable, and takes no new message.';
  if (!admin) return 'Admins and owners send messages to agents; you can read this chat.';
  if (placement === null)
    return "The agent doesn't run anywhere now: choose where it runs on its page first.";
  return undefined;
}

/** True while the chat's last turn asks the person something they have not answered. */
export function asking(thread: readonly ChatTurnWithEvents[]): boolean {
  const last = lastTalk(thread);
  const question = last && questionOf(last.events);
  return question !== undefined && !question.answered && sentAnswer(question.event.id) === undefined;
}

/**
 * Send (with its delivery while a turn runs, or with the stopped machine started for it), Stop, an answer and a profile
 * change, each shown at once.
 */
export function chatActions(calls: ChatCalls, live: ChatLive, chat: Chat, onChanged: () => void) {
  const running = live.turns.find((turn) => turn.status === 'running');
  const first = live.turns.length === 0;
  return {
    running,
    send: async (
      prompt: string,
      delivery: ChatDelivery | undefined,
      options: { readonly startMachine?: boolean } = {},
    ) => {
      live.putTurn(await calls.send(chat.id, prompt, delivery, options.startMachine === true));
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
export function queueActions(
  calls: ChatCalls,
  live: ChatLive,
  chat: Chat,
  running: ChatTurnWithEvents | undefined,
) {
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

/**
 * The thread's turns, the waiting messages in start order, the running turn and how a message may reach it now (after
 * the turns that wait, the one waiting for the stopped machine too).
 */
export function queueView(live: ChatLive, chat: Chat) {
  const { thread, queue } = splitQueue(live.turns);
  const running = live.turns.find((turn) => turn.status === 'running');
  const waiting = queue.length > 0 || live.turns.some(waitsForMachine) ? AFTER_ONLY : undefined;
  const choices = running ? deliveryChoices(chat.harness, running) : waiting;
  return { thread, queue, running, choices };
}
