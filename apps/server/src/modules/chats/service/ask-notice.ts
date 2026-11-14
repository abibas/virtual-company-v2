import type { TenantDb } from '@mwc/db';
import type { AskQuestion } from '@mwc/shared/harness';
import { noticeAgentQuestion } from '../../notifications/service.ts';
import { participantsRepo } from '../repo/participants.ts';
import { chatsRepo } from '../repo.ts';
import { isMessageChat, mayJoin } from '../rules/people.ts';

/** The people of a message chat who may answer in it: its members, active and above a viewer. */
async function writers(t: TenantDb, chatId: string): Promise<string[]> {
  const members = (await participantsRepo.membersOf(t, [chatId])).get(chatId) ?? [];
  return (await participantsRepo.members(t, members)).filter(mayJoin).map((member) => member.principalId);
}

/**
 * An agent asked a question in a chat (S6c, docs/notifications.md): once its `question` event is stored, the people who
 * may answer it (the company's admins and owners) hear of it, quoting its first question and pointing at the chat; the
 * agent never does. A task's conversation asks like any chat; a message chat's question goes to the people in it who
 * may answer there, members too, and to nobody else (2026-11-14, docs/harness.md "Who is in a chat").
 */
export async function noticeQuestion(
  t: TenantDb,
  chatId: string,
  questions: readonly AskQuestion[],
): Promise<void> {
  const chat = await chatsRepo.get(t, chatId);
  const agent = chat && (await chatsRepo.agentOf(t, chat.agentId));
  const [first] = questions;
  if (chat === undefined || agent === undefined || first === undefined) return;
  const only = isMessageChat(chat) ? await writers(t, chat.id) : undefined;
  const question = {
    agentPrincipalId: agent.principalId,
    agentId: agent.id,
    chatId: chat.id,
    text: first.question,
  };
  await noticeAgentQuestion(t, question, only);
}
