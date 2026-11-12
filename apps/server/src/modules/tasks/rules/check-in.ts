import type { Task } from '@mwc/db';
import type { CheckInTurn, LeadCheckInTask } from '@mwc/shared/flows';
import { readableReason } from './failure.ts';

// A flow Lead's check-ins (docs/processes.md "Check-ins"), pure: when one is due (every N minutes after the Lead's
// last wake-up, and after the flow was last looked at for one), when a due one is skipped, and an open task as its
// digest tells it.

const MINUTE_MS = 60_000;

/**
 * True once the flow's check-in is due: `minutes` after the later of its last wake-up (any kind, told) and the last
 * time the server looked at it for a check-in (the first time it saw the flow with work starts that clock).
 */
export function checkInDue(of: {
  readonly minutes: number;
  readonly lookedAt: Date;
  readonly lastWoke: Date | undefined;
  readonly now: Date;
}): boolean {
  const since = Math.max(of.lookedAt.getTime(), of.lastWoke?.getTime() ?? 0);
  return of.now.getTime() - since >= of.minutes * MINUTE_MS;
}

/** What the server knows of the flow when its check-in is due. */
export interface CheckInFacts {
  /** The Lead has a turn running or waiting in any of its chats. */
  readonly leadBusy: boolean;
  /** Events of the flow wait for their quiet window: their wake-up comes first. */
  readonly pending: boolean;
  /** A task of the flow has a history row since the Lead was last told (true before any wake-up). */
  readonly changed: boolean;
  /** A task is blocked, or marked working with no turn running or waiting on it. */
  readonly stuck: boolean;
}

/** Why a due check-in is skipped; undefined when it goes. */
export type CheckInSkip = 'lead_busy' | 'pending' | 'quiet';

export function checkInSkip(facts: CheckInFacts): CheckInSkip | undefined {
  if (facts.leadBusy) return 'lead_busy';
  if (facts.pending) return 'pending';
  return !facts.changed && !facts.stuck ? 'quiet' : undefined;
}

/** An open task (active or escalated) as the digest tells it, as of `now`. */
export function checkInTask(
  task: Pick<
    Task,
    'number' | 'title' | 'state' | 'stepState' | 'blockedReason' | 'escalationReason' | 'updatedAt'
  >,
  of: {
    readonly key: string;
    readonly step: string | null;
    readonly since: Date | undefined;
    readonly turn: CheckInTurn | undefined;
    readonly now: Date;
  },
): LeadCheckInTask {
  const escalated = task.state === 'escalated';
  const since = of.since ?? task.updatedAt;
  return {
    task: { key: of.key, title: task.title },
    state: escalated ? 'escalated' : 'active',
    step: of.step,
    stepState: escalated ? null : task.stepState,
    minutes: (of.now.getTime() - since.getTime()) / MINUTE_MS,
    turn: of.turn ?? 'none',
    reason: escalated
      ? task.escalationReason
      : task.stepState === 'blocked'
        ? readableReason(task.blockedReason)
        : null,
  };
}
