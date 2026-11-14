import type { TenantDb } from '@mwc/db';
import type { AskQuestion } from '@mwc/shared/harness';
import { noticeAgentQuestion } from '../../notifications/service.ts';
import { participantsRepo } from '../repo/participants.ts';
import { chatsRepo } from '../repo.ts';
import { isMessageChat } from '../rules/people.ts';

/**
 * An agent asked a question in a chat (S6c, docs/notifications.md): once its `question` event is stored, the people who
 * may answer it (the company's admins and owners) hear of it, quoting its first question and pointing at the chat; the
 * agent never does. A task's conversation asks like any chat; a message chat's question goes only to the people in it
 * (2026-11-14, docs/harness.md "Who is in a chat").
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
  const only = isMessageChat(chat)
    ? ((await participantsRepo.membersOf(t, [chat.id])).get(chat.id) ?? [])
    : undefined;
  const question = {
    agentPrincipalId: agent.principalId,
    agentId: agent.id,
    chatId: chat.id,
    text: first.question,
  };
  await noticeAgentQuestion(t, question, only);
}
