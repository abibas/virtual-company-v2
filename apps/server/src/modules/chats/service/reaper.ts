import { type Agent, type Chat, type DbHandle, tenant } from '@mwc/db';
import type { Logger } from 'pino';
import { failWaitingTurns, type ReapedTurn } from '../repo/reaper.ts';
import { chatsRepo } from '../repo.ts';
import { SERVER_RESTARTED } from './adopt.ts';
import { type TaskTurnHook, taskContext, taskDraft } from './task-hook.ts';

export { SERVER_RESTARTED } from './adopt.ts';

/**
 * At the server's start, before it listens (S5.1b, `platform/start.ts`): every turn left waiting by a stopped server in
 * a chat where nothing runs fails with `server_restarted`. A running turn is not failed here (S5.4): its runner keeps it
 * and takes it back to this server, and the waiting turns of its chat start once it ends; the ones no runner takes back
 * within the grace end then (`adopt.ts`, `failLeftTurns`). A message turn of a task's conversation (S5.3b) that failed
 * here is reported to the tasks module's hook as a failed turn. Says how many when there were any; one that cannot run
 * (an unmigrated database) is a warning, never a stop. Returns how many failed.
 */
export async function reapTurns(deps: {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly tasks?: TaskTurnHook | undefined;
}): Promise<number> {
  try {
    const failed = await failWaitingTurns(deps.db, deps.clock(), SERVER_RESTARTED);
    if (failed.length > 0)
      deps.logger.info({ failed: failed.length }, 'failed the chat turns a stopped server left waiting');
    for (const turn of failed) if (turn.kind === 'message') await reportTask(deps, turn);
    return failed.length;
  } catch (error) {
    deps.logger.warn({ err: error }, 'could not fail the chat turns a stopped server left waiting');
    return 0;
  }
}

/** Tells the tasks module of a reaped turn of a task's conversation (none for any other chat). */
async function reportTask(deps: Parameters<typeof reapTurns>[0], turn: ReapedTurn): Promise<void> {
  if (deps.tasks === undefined) return;
  try {
    const t = await tenant(deps.db, turn.companyId);
    const chat = (await chatsRepo.get(t, turn.chatId)) as Chat;
    const agent = (await chatsRepo.agentOf(t, chat.agentId)) as Agent;
    const task = taskContext(await taskDraft(deps.tasks, t, { chat, agent, kind: turn.kind }), turn);
    if (task !== undefined) {
      await deps.tasks.ended(t, task, { status: 'failed', resultText: null, error: SERVER_RESTARTED });
    }
  } catch (error) {
    // A company deleted since: nothing of it runs any more.
    deps.logger.warn(
      { err: error, turnId: turn.id },
      'could not tell the task of a turn a stopped server left',
    );
  }
}
