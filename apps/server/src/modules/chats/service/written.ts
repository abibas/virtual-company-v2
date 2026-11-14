import type { DbHandle, TenantDb } from '@mwc/db';
import { CHAT_PROMPT } from '@mwc/shared/chats';
import { participantsRepo } from '../repo/participants.ts';
import { groupHeader, groupPrompt, promptTooLong } from '../rules/people.ts';
import type { Refusal } from '../rules.ts';
import { memberNames } from './faces.ts';

/**
 * A person's message as the agent gets it (2026-11-14, docs/harness.md "Who is in a chat"): in a chat with several
 * people (members and contacts) their name goes first, so the agent knows who asks, and the thread keeps what they
 * wrote (`shown`, the turn's visible text); in a chat of one person, as written.
 */
export async function writtenIn(
  db: DbHandle,
  t: TenantDb,
  chatId: string,
  principalId: string,
  text: string,
): Promise<{ readonly ok: true; readonly prompt: string; readonly shown?: string } | Refusal> {
  const people = await participantsRepo.ofChat(t, chatId);
  if (people.length < 2) return { ok: true, prompt: text };
  const { name } = (await memberNames(db, t, [principalId]))(principalId);
  const prompt = groupPrompt(name, text);
  if (prompt === undefined) return promptTooLong(groupHeader(name).length + text.length - CHAT_PROMPT.max);
  return { ok: true, prompt, shown: text };
}
