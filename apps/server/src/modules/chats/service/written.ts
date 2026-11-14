import type { DbHandle, TenantDb } from '@mwc/db';
import { CHAT_PROMPT } from '@mwc/shared/chats';
import { participantsRepo } from '../repo/participants.ts';
import { imageOrderHeader } from '../rules/images.ts';
import { groupHeader, groupPrompt, promptTooLong } from '../rules/people.ts';
import type { Refusal } from '../rules.ts';
import { memberNames } from './faces.ts';

/**
 * A person's message as the agent gets it (2026-11-14, docs/harness.md "Who is in a chat"): in a chat with several
 * people (members and contacts) their name goes first, so the agent knows who asks, and the thread keeps what they
 * wrote (`shown`, the turn's visible text); in a chat of one person, as written. A message whose text marks its
 * images (`[Image 1]`, T-20) opens with the line that says they come in the order of their markers, also kept out of
 * what the thread shows (dropped when it would make the prompt too long).
 */
export async function writtenIn(
  db: DbHandle,
  t: TenantDb,
  chatId: string,
  principalId: string,
  text: string,
  images = 0,
): Promise<{ readonly ok: true; readonly prompt: string; readonly shown?: string } | Refusal> {
  const order = imageOrderHeader(text, images);
  const people = await participantsRepo.ofChat(t, chatId);
  if (people.length < 2) {
    const ordered = `${order}${text}`;
    return order === '' || ordered.length > CHAT_PROMPT.max
      ? { ok: true, prompt: text }
      : { ok: true, prompt: ordered, shown: text };
  }
  const { name } = (await memberNames(db, t, [principalId]))(principalId);
  const prompt = groupPrompt(name, text);
  if (prompt === undefined) return promptTooLong(groupHeader(name).length + text.length - CHAT_PROMPT.max);
  const ordered = `${order}${prompt}`;
  return { ok: true, prompt: ordered.length > CHAT_PROMPT.max ? prompt : ordered, shown: text };
}
