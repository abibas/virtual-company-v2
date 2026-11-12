import { CHAT_PAGE } from '@mwc/shared/chats';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import type { AnswerBody, Chat, ChatChanges, ChatDelivery } from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * Chats with an agent on its machine (S5.1c, docs/harness.md "How a turn runs"): an agent's chats, one chat with its
 * current conversation and its older turns a page at a time, the changes admins make (begin, rename or choose the profile, archive, branch), prompts and Stop, an owner's terminal
 * ticket, the waiting messages (S5.2 step 6), and the chat's stream (Server-Sent Events read with the client's own Bearer header, never `EventSource`).
 */

/** A page of older turns: before `beforeSeq`, after `afterSeq` (0: from the start), at most `limit`. */
export interface OlderPage {
  readonly beforeSeq: number;
  readonly afterSeq: number;
  readonly limit?: number;
}

/** An agent's chats, the latest first (archived ones are left out). */
export function useAgentChats(
  companyId: string,
  agentId: string,
): Loaded<{ readonly chats: readonly Chat[] }> {
  const api = useApi();
  return useLoad(`chats:${companyId}:${agentId}`, () => chatCalls(api, companyId).list(agentId));
}

/** The calls on a company's chats. */
export function chatCalls(api: Api, companyId: string) {
  const agentChats = api.api.companies[':companyId'].agents[':agentId'].chats;
  const one = api.api.companies[':companyId'].chats[':chatId'];
  const param = (chatId: string) => ({ param: { companyId, chatId } });
  return {
    list: (agentId: string) => call(agentChats.$get({ param: { companyId, agentId } })),
    create: (agentId: string, profileId: string | null = null) =>
      call(agentChats.$post({ param: { companyId, agentId }, json: { profileId } })),
    get: (chatId: string) => call(one.$get(param(chatId))),
    /** Older turns, the latest `limit` before `beforeSeq` and after `afterSeq` (both exclusive), in order. */
    older: (chatId: string, page: OlderPage) =>
      call(
        one.turns.$get({
          ...param(chatId),
          query: {
            beforeSeq: String(page.beforeSeq),
            afterSeq: String(page.afterSeq),
            limit: String(page.limit ?? CHAT_PAGE.default),
          },
        }),
      ),
    update: (chatId: string, changes: ChatChanges) => call(one.$patch({ ...param(chatId), json: changes })),
    archive: (chatId: string) => call(one.$delete(param(chatId))),
    /** A new chat that continues this one's conversation from the reply of `turnId` (201). */
    branch: (chatId: string, turnId: string) =>
      call(one.branch.$post({ ...param(chatId), json: { turnId } })),
    /**
     * A prompt; with a `delivery` while a turn runs (S5.2 step 6): into it, after it, or interrupting it; with
     * `startMachine` the agent's stopped machine is started for it (Start and send), and it waits for it.
     */
    send: (chatId: string, prompt: string, delivery?: ChatDelivery, startMachine = false) =>
      call(
        one.turns.$post({
          ...param(chatId),
          json: { prompt, ...(delivery ? { delivery } : {}), ...(startMachine ? { startMachine } : {}) },
        }),
      ),
    /** S5.2 step 6: a waiting message's new prompt, its discard (204), and Now or Interrupt for it. */
    edit: (chatId: string, turnId: string, prompt: string) =>
      call(one.turns[':turnId'].$patch({ param: { companyId, chatId, turnId }, json: { prompt } })),
    discard: (chatId: string, turnId: string) =>
      call(one.turns[':turnId'].$delete({ param: { companyId, chatId, turnId } })),
    deliver: (chatId: string, turnId: string, delivery: 'now' | 'interrupt') =>
      call(one.turns[':turnId'].deliver.$post({ param: { companyId, chatId, turnId }, json: { delivery } })),
    stop: (chatId: string, turnId: string) =>
      call(one.turns[':turnId'].stop.$post({ param: { companyId, chatId, turnId } })),
    /** S5.2: the harness's own `/compact` as a turn (202), and a Clear (200): the next turn starts a new conversation. */
    compact: (chatId: string) => call(one.compact.$post(param(chatId))),
    clear: (chatId: string) => call(one.clear.$post(param(chatId))),
    /** S5.2 step 4: the person's answers to the agent's open question, sent as the chat's next turn (202). */
    answer: (chatId: string, body: AnswerBody) => call(one.answers.$post({ ...param(chatId), json: body })),
    terminalTicket: (chatId: string) => call(one['terminal-tickets'].$post(param(chatId))),
    /** The raw stream response (its body goes to `readEventStream`); `lastEventId` replays what came after it. */
    stream: (chatId: string, lastEventId: string | undefined, signal: AbortSignal) =>
      one.stream.$get(
        { ...param(chatId), header: lastEventId === undefined ? {} : { 'last-event-id': lastEventId } },
        { init: { signal } },
      ),
  };
}

export type ChatCalls = ReturnType<typeof chatCalls>;
