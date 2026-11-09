import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import type { Chat, ChatChanges } from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * Chats with an agent on its machine (S5.1c, docs/harness.md "How a turn runs"): an agent's chats, one chat with its
 * turns, the changes admins make (begin, rename or choose the profile, archive), prompts and Stop, an owner's terminal
 * ticket, and the chat's stream (Server-Sent Events read with the client's own Bearer header, never `EventSource`).
 */

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
    update: (chatId: string, changes: ChatChanges) => call(one.$patch({ ...param(chatId), json: changes })),
    archive: (chatId: string) => call(one.$delete(param(chatId))),
    send: (chatId: string, prompt: string) => call(one.turns.$post({ ...param(chatId), json: { prompt } })),
    stop: (chatId: string, turnId: string) =>
      call(one.turns[':turnId'].stop.$post({ param: { companyId, chatId, turnId } })),
    /** S5.2: the harness's own `/compact` as a turn (202), and a Clear (200): the next turn starts a new conversation. */
    compact: (chatId: string) => call(one.compact.$post(param(chatId))),
    clear: (chatId: string) => call(one.clear.$post(param(chatId))),
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
