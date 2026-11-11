import type { DbHandle, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import type { AskQuestion, TurnEvent } from '@mwc/shared/harness';
import { type OpenQuestion, openQuestion } from '../../chats/rules/questions.ts';
import type { InboxRepo, QuestionRow } from '../repo.ts';
import { answersQuestions, type Viewer } from '../rules.ts';
import type { InboxCompany, InboxItem } from '../schemas.ts';
import { namesOf } from './names.ts';

/**
 * The agents' open questions (S6b): a chat's question is open while it is the latest of the chat's last turn and nothing
 * answered it (the chats module's own rule, `openQuestion`). Only for those who may answer (`answersQuestions`: admins
 * and owners), in chats and of agents not archived; a task's conversation asks like any chat.
 */

/** The open question of a chat's last turn, with when it was asked; undefined when it is answered. */
function openOf(row: QuestionRow): { readonly open: OpenQuestion; readonly at: Date } | undefined {
  const turn = {
    id: row.turnId,
    seq: row.seq,
    events: row.events.map((e) => ({ event: e.event as TurnEvent })),
  };
  const open = openQuestion([turn]);
  if (open === null) return undefined;
  // The open question is the turn's latest.
  const asked = row.events.findLast((e) => e.event.type === 'question') as QuestionRow['events'][number];
  return { open, at: asked.at };
}

/** The company's open questions the viewer may answer, as inbox items (unsorted). */
export async function questionItems(
  deps: { readonly db: DbHandle },
  repo: InboxRepo,
  t: TenantDb,
  viewer: Viewer,
  company: InboxCompany,
): Promise<InboxItem[]> {
  if (!answersQuestions(viewer.role)) return [];
  const asking = (await repo.questions.lastTurnsAsking(t)).flatMap((row) => {
    const found = openOf(row);
    return found === undefined ? [] : [{ ...found, chatId: row.chatId }];
  });
  if (asking.length === 0) return [];
  const chats = new Map(
    (
      await repo.questions.chatsOf(
        t,
        asking.map((a) => a.chatId),
      )
    ).map((chat) => [chat.id, chat]),
  );
  const names = await namesOf(
    deps.db,
    repo,
    t,
    [...chats.values()].map((chat) => chat.agentPrincipalId),
  );
  return asking.flatMap(({ open, at, chatId }): InboxItem[] => {
    const chat = chats.get(chatId);
    if (chat === undefined) return [];
    const agent = names(chat.agentPrincipalId);
    const [first] = open.questions as [AskQuestion, ...AskQuestion[]];
    return [
      {
        id: `question:${open.id}`,
        kind: 'question',
        company,
        title: first.question,
        subtitle: chat.title === null ? agent.name : `${agent.name} · ${chat.title}`,
        reason: null,
        from: agent,
        link: `chats/${chat.agentId}?chat=${chat.id}`,
        actions: ['answer'],
        task: null,
        question: {
          chatId: chat.id,
          agentId: chat.agentId,
          questionId: open.id,
          count: open.questions.length,
          chatTitle: chat.title,
          taskKey: chat.taskNumber === null ? null : taskKey(chat.taskNumber),
        },
        at: at.toISOString(),
      },
    ];
  });
}
