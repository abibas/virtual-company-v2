import { CHAT_PROMPT } from '@mwc/shared/chats';
import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { refuse } from '../rules.ts';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"), pure. An agent's message chats (neither a task's
 * conversation nor a flow's team chat, which keep their own rules) are locked to their people: a member in the chat
 * lists, opens, streams and writes in it; a company owner who is not in it opens it read-only (the owner view); anyone
 * else gets the same 404 as an unknown chat. Any person in a chat adds members; the chat's creator and the owners take
 * someone out, and anyone may leave. A person's message in a chat with several people goes to the agent with their name
 * first, so it knows who asks.
 */

/** How a member reaches a chat: its own rules (`open`), in it, as an owner who reads it, or not at all. */
export type ChatSeat = 'open' | 'in' | 'owner' | 'none';

/** A message chat: neither a task's conversation nor a flow's team chat. */
export const isMessageChat = (chat: { readonly taskId: string | null; readonly flowId: string | null }) =>
  chat.taskId === null && chat.flowId === null;

/** Where a member stands in a chat (see above). */
export function seatOf(
  chat: { readonly taskId: string | null; readonly flowId: string | null },
  inChat: boolean,
  role: MembershipRole,
): ChatSeat {
  if (!isMessageChat(chat)) return 'open';
  if (inChat) return 'in';
  return role === 'owner' ? 'owner' : 'none';
}

export const NOT_IN_CHAT = refuse(
  403,
  'not_in_chat',
  'You are not in this chat: an owner reads it only. Add yourself to write in it',
);
export const PERSON_NOT_MEMBER = refuse(
  422,
  'person_not_member',
  'Only active members of the company (not viewers) can be in a chat',
);
export const PERSON_IN_CHAT = refuse(409, 'person_in_chat', 'Everyone named is in this chat already');
export const PERSON_NOT_FOUND = refuse(404, 'person_not_found', 'No such person in this chat');
export const REMOVE_REFUSED = refuse(
  403,
  'remove_refused',
  "Only the chat's creator or a company owner takes someone else out; anyone may leave",
);
export const PEOPLE_UNSUPPORTED = refuse(
  409,
  'people_unsupported',
  "A task's conversation and a team chat keep their own rules: they have no people of their own",
);
export const OWNER_ADDS_SELF = refuse(
  403,
  'not_in_chat',
  'You are not in this chat: an owner may add only themselves (Add me), then others',
);

/** True when this membership may be in a chat: active, and above a viewer (who reads no chats). */
export const mayJoin = (member: { readonly role: MembershipRole; readonly status: MembershipStatus }) =>
  member.status === 'active' && member.role !== 'viewer';

/** What a people line says happened. */
export type PeopleChange = 'added' | 'removed' | 'left' | 'joined';

/** The quiet line a `people` turn shows in the thread. */
export function peopleLine(change: PeopleChange, actor: string, subject: string): string {
  if (change === 'left') return `${actor} left the chat`;
  if (change === 'joined') return `${actor} joined the chat`;
  return `${actor} ${change} ${subject}`;
}

/** Who may take a person out: themselves always; someone else only the chat's creator or a company owner. */
export function mayRemove(
  who: { readonly principalId: string; readonly role: MembershipRole },
  chat: { readonly createdBy: string },
  target: { readonly principalId: string | null },
): boolean {
  if (target.principalId === who.principalId) return true;
  return chat.createdBy === who.principalId || who.role === 'owner';
}

/** The header of a person's message in a chat with several people. */
export const groupHeader = (name: string) => `Message from ${name}:\n\n`;

/** A person's message as the agent gets it in a chat with several people; undefined when it no longer fits. */
export function groupPrompt(name: string, text: string): string | undefined {
  const prompt = `${groupHeader(name)}${text}`;
  return prompt.length <= CHAT_PROMPT.max ? prompt : undefined;
}

export const promptTooLong = (by: number) =>
  refuse(
    422,
    'prompt_too_long',
    `In a chat with several people your name goes before your message: shorten it by ${by} characters`,
  );

/**
 * A waiting message's new prompt: with the header its prompt had before what the person wrote (a chat with several
 * people), the header kept before the new text; else the text alone.
 */
export function editedPrompt(
  turn: { readonly prompt: string; readonly visibleText: string | null; readonly system: boolean },
  text: string,
): { readonly prompt: string; readonly visibleText?: string } {
  const shown = turn.visibleText;
  if (turn.system || shown === null || !turn.prompt.endsWith(shown)) return { prompt: text };
  return { prompt: `${turn.prompt.slice(0, turn.prompt.length - shown.length)}${text}`, visibleText: text };
}
