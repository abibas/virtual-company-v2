import type { ChatTurn, TenantDb } from '@mwc/db';
import { isDisconnected } from '@mwc/shared/chats';
import type { Logger } from 'pino';
import { turnsRepo } from '../repo/turns.ts';
import type { TaskTurnContext, TaskTurnHook } from './task-hook.ts';

/**
 * A late re-attach (2026-11-12, the safety net under the 30-minute grace, docs/harness.md "Surviving restarts"): a
 * runner's hello names a turn the server already ended because its runner was away (`machine_disconnected`, or
 * `server_restarted` after a restart), while the runner kept it going. The turn is taken back when nothing else started
 * in its chat since: its row runs again, and a task step's turn only when the task was blocked by that failure and has
 * not moved since (the tasks module's hook undoes the block; otherwise the row is put back as it was). Undefined means
 * it stays failed, and the runner hears it is gone and stops it.
 */

/** Why a turn ended that its runner may still come back with. */
export const SERVER_RESTARTED = 'server_restarted';

/** True for a failed turn the server ended because its runner was away. */
export const endedAway = (turn: Pick<ChatTurn, 'status' | 'error'>): boolean =>
  turn.status === 'failed' && (isDisconnected(turn.error) || turn.error === SERVER_RESTARTED);

export interface ReclaimDeps {
  readonly logger: Logger;
  readonly tasks?: TaskTurnHook | undefined;
}

/** What the turn belongs to: its task step's context, and whether its chat is a task's message conversation. */
export interface ReclaimedOf {
  readonly task: TaskTurnContext | undefined;
  readonly taskTurn: boolean;
}

/** The turn running again, or undefined when it stays failed (see above). */
export async function reclaim(
  deps: ReclaimDeps,
  t: TenantDb,
  turn: ChatTurn,
  of: ReclaimedOf,
): Promise<ChatTurn | undefined> {
  const why = { turnId: turn.id, chatId: turn.chatId };
  if (await turnsRepo.startedAfter(t, turn.chatId, turn.seq)) {
    deps.logger.info(why, 'chats: a turn came back after another started in its chat; it stays failed');
    return undefined;
  }
  // A task's step is gone, or the hook can't say the block was this turn's: the task moved.
  if (of.taskTurn && (of.task === undefined || deps.tasks?.reattached === undefined)) return undefined;
  const reopened = await turnsRepo.reopen(t, turn);
  if (reopened === undefined) return undefined;
  if (of.task !== undefined && !(await deps.tasks?.reattached?.(t, of.task, { error: turn.error }))) {
    await turnsRepo.updateLive(t, turn.id, { status: turn.status, error: turn.error, endedAt: turn.endedAt });
    deps.logger.info(why, 'chats: a turn came back after its task moved on; it stays failed');
    return undefined;
  }
  deps.logger.info(why, 'chats: took back a turn its runner came back with after the grace');
  return reopened;
}
