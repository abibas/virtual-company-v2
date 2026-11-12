import type { TenantDb } from '@mwc/db';
import type { AskQuestion } from '@mwc/shared/harness';
import { noticeAgentQuestion } from '../../notifications/service.ts';
import { chatsRepo } from '../repo.ts';

/**
 * An agent asked a question in a chat (S6c, docs/notifications.md): once its `question` event is stored, the people who
 * may answer it (the company's admins and owners) hear of it, quoting its first question and pointing at the chat; the
 * agent never does. A task's conversation asks like any chat.
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
  await noticeAgentQuestion(t, {
    agentPrincipalId: agent.principalId,
    agentId: agent.id,
    chatId: chat.id,
    text: first.question,
  });
}
