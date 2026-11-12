import type { TenantDb } from '@mwc/db';
import { ROOM_BODY_MAX, stepEndText, taskKey } from '@mwc/shared/flows';
import type { TasksRepo } from '../../repo.ts';
import type { StepEndLine } from '../../rules/room.ts';

/**
 * What Most Wanted and the agents post in a flow's team room without anyone writing (docs/processes.md "The team
 * room"): a step agent's one line when its step ends (in the move's transaction: no turn, no tokens, nobody woken), Most
 * Wanted's notices (a Lead's wake-up or check-in with its turn, agents not asked, a turn that failed), and an agent's
 * reply from its room conversation. Each at the app's clock.
 */

/** Why Most Wanted posted a notice. */
export type NoticeAbout = 'wake' | 'check_in' | 'not_asked' | 'failed';

/** A body within the room's limit. */
const fit = (text: string) => (text.length <= ROOM_BODY_MAX ? text : `${text.slice(0, ROOM_BODY_MAX - 1)}…`);

/** A step agent's line when its step ended, under its face, linked to the task. */
export async function postStepEnd(
  repo: TasksRepo,
  tx: TenantDb,
  line: {
    readonly flowId: string;
    readonly task: { readonly id: string; readonly number: number };
    readonly agentPrincipalId: string;
    readonly end: StepEndLine;
    readonly now: Date;
  },
): Promise<void> {
  const { details, words } = line.end;
  await repo.room.insert(tx, {
    flowId: line.flowId,
    kind: 'step_end',
    authorPrincipalId: line.agentPrincipalId,
    body: stepEndText(taskKey(line.task.number), details, words),
    taskId: line.task.id,
    details: { ...details, words },
    createdAt: line.now,
  });
}

/** Most Wanted's notice, with the turn it queued when there is one. */
export async function postNotice(
  repo: TasksRepo,
  t: TenantDb,
  notice: {
    readonly flowId: string;
    readonly body: string;
    readonly about: NoticeAbout;
    readonly now: Date;
    readonly turn?: { readonly chatId: string; readonly turnId: string } | undefined;
  },
): Promise<void> {
  await repo.room.insert(t, {
    flowId: notice.flowId,
    kind: 'notice',
    authorPrincipalId: null,
    body: fit(notice.body),
    details: { about: notice.about },
    chatId: notice.turn?.chatId ?? null,
    turnId: notice.turn?.turnId ?? null,
    createdAt: notice.now,
  });
}

/** An agent's reply from a turn of its room conversation, under its face. */
export async function postReply(
  repo: TasksRepo,
  t: TenantDb,
  reply: {
    readonly flowId: string;
    readonly agentPrincipalId: string;
    readonly body: string;
    readonly chatId: string;
    readonly turnId: string;
    readonly replyTo: string | null;
    readonly now: Date;
  },
): Promise<void> {
  await repo.room.insert(t, {
    flowId: reply.flowId,
    kind: 'reply',
    authorPrincipalId: reply.agentPrincipalId,
    body: fit(reply.body),
    details: reply.replyTo === null ? {} : { replyTo: reply.replyTo },
    chatId: reply.chatId,
    turnId: reply.turnId,
    createdAt: reply.now,
  });
}
