import type { DbHandle } from '@mwc/db';
import type { Logger } from 'pino';
import { failLiveTurns } from '../repo/reaper.ts';

/** Why a turn a stopped server left live failed. */
export const SERVER_RESTARTED = 'server_restarted';

/**
 * At the server's start, before it listens (S5.1b, `platform/start.ts`): every turn left queued or running by a stopped
 * server fails with `server_restarted`, since its runner dropped it with the old server's connection. Says how many when
 * there were any; one that cannot run (an unmigrated database) is a warning, never a stop. Returns how many failed.
 */
export async function reapTurns(deps: {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger: Logger;
}): Promise<number> {
  try {
    const failed = await failLiveTurns(deps.db, deps.clock(), SERVER_RESTARTED);
    if (failed > 0) deps.logger.info({ failed }, 'failed the chat turns a stopped server left running');
    return failed;
  } catch (error) {
    deps.logger.warn({ err: error }, 'could not fail the chat turns a stopped server left running');
    return 0;
  }
}
