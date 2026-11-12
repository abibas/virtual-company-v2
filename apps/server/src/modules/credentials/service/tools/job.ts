import { dueToolChecks } from '../../repo/checks-due.ts';
import { checkStoredTool, type ToolDeps } from './check.ts';

/**
 * The daily check of the tool sign-ins (S7.1a), a job of the jobs loop: at most every 10 minutes it finds up to 10
 * sign-ins due (`toolCheckDue`: never checked, checked a day ago, or an hour ago when that check did not finish) and
 * checks each through its owner's layer, the system acting. One that fails is logged and comes round again; it never
 * stops the others.
 */

/** How often the job looks for due sign-ins, and how many it checks each time. */
export const TOOL_SWEEP_MS = 10 * 60_000;
export const TOOL_CHECK_BATCH = 10;

/** What one pass did: the sign-ins checked, how many of them work, need signing in again or did not finish. */
export interface ToolChecks {
  readonly checked: number;
  readonly active: number;
  readonly needsSignIn: number;
  readonly failed: number;
}

/** The job: each call is one tick; null on the ticks between two passes. */
export function toolCheckJob(deps: ToolDeps): () => Promise<ToolChecks | null> {
  let nextMs = Number.NEGATIVE_INFINITY;
  return async () => {
    const now = deps.clock();
    if (now.getTime() < nextMs) return null;
    nextMs = now.getTime() + TOOL_SWEEP_MS;
    const tally = { checked: 0, active: 0, needsSignIn: 0, failed: 0 };
    for (const row of await dueToolChecks(deps.db, now, TOOL_CHECK_BATCH)) {
      const after = await checkStoredTool(deps, row, { kind: 'system' });
      if (after === undefined) continue;
      tally.checked++;
      if (after.checkError !== null) tally.failed++;
      else if (after.status === 'needs_sign_in') tally.needsSignIn++;
      else tally.active++;
    }
    return tally;
  };
}
