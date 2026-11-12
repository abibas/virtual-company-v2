import type { DbHandle, Notification, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import { principalNames, SOMEONE } from '../../org/service/names.ts';
import type { NotificationsRepo } from '../repo.ts';
import { type Names, noticePath, noticeText } from '../rules/words.ts';
import type { NoticePayload } from '../rules.ts';

/** The principals a notice names: whom it is about, the managers of a move, and who made it. */
export function mentioned(rows: readonly Notification[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const payload = row.payload as unknown as NoticePayload;
    for (const id of [payload.about, payload.from, payload.to, row.actorPrincipalId]) if (id) ids.add(id);
  }
  return [...ids];
}

/** The tasks notices name (S5.3a). */
export function mentionedTasks(rows: readonly Notification[]): string[] {
  const ids = rows.flatMap((row) => (row.payload as unknown as NoticePayload).task ?? []);
  return [...new Set(ids)];
}

/**
 * The names of these principals as they are now (the org module's `principalNames`, outside any transaction: a person's
 * name, their email while they have none, and an agent's name and slug; `SOMEONE` for nobody known); and these tasks'
 * keys and titles. The org module is imported by its file, not its index, which imports this module's service.
 */
export async function namesOf(
  db: DbHandle,
  repo: NotificationsRepo,
  t: TenantDb,
  ids: readonly string[],
  taskIds: readonly string[] = [],
): Promise<Names> {
  const names = await principalNames(db, t, ids);
  const tasks = new Map((await repo.tasks(t, taskIds)).map((task) => [task.id, task]));
  return {
    name: (id) => (id ? names(id).name : SOMEONE),
    agentSlug: (id) => names(id).slug ?? undefined,
    task: (id) => {
      const task = id === undefined ? undefined : tasks.get(id);
      return task && { key: taskKey(task.number), title: task.title };
    },
  };
}

/** A notification as its recipient reads it: its words, who made it and where it points. */
export function shown(row: Notification, names: Names, company: string) {
  const payload = row.payload as unknown as NoticePayload;
  const actor = row.actorPrincipalId;
  return {
    text: noticeText(row.kind, payload, names, company),
    actor: actor === null ? null : { principalId: actor, name: names.name(actor) },
    path: noticePath(row.kind, payload, names),
  };
}
