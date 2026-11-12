import { type DbHandle, type Flow, tenant } from '@mwc/db';
import type { Logger } from 'pino';
import type { Timers } from '../../../../platform/jobs/runner.ts';
import type { TeamChats } from '../../../chats/index.ts';
import { stampSeen, type WaitingSignoff, waitingFlows, waitingSignoffs } from '../../repo/wakes-due.ts';
import { tasksRepo } from '../../repo.ts';
import { rosterOf } from '../team.ts';
import { deliverFlow, type FlowDelivery } from './deliver.ts';
import { recordWake } from './record.ts';

/**
 * The server's wake-up tick (S6c, docs/processes.md "Built: the Lead wakes up"): every few seconds in the process that
 * holds the runners' sockets (the app's, started by `createApp` when the server runs its background work), it writes a
 * `signoff_waiting` event for each task that has waited past its flow's hours for a person's sign-off, stamps the new
 * pending events with its clock, then delivers each flow whose quiet window has passed (`deliverFlow`). One tick at a
 * time; a failure is logged and the next tick tries again. Nothing lives only in memory: the rows say what is due.
 */

/** Time between two ticks. */
export const WAKE_TICK_MS = 5_000;
/** Flows (and waiting sign-offs) one tick looks at, the longest waiting first. */
export const WAKE_FLOWS_PER_TICK = 20;

export interface LeadWakesDeps {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger: Logger;
  /** The chats' side of a wake-up; none: events wait, untold. */
  readonly chats?: TeamChats | undefined;
}

/** What one tick did: the sign-off waits it found, the events it saw first, and each flow's outcome. */
export type WakeTick = { readonly signoffs: number; readonly seen: number } & Readonly<
  Record<FlowDelivery, number>
>;

/** Writes the sign-off wait of a task (its flow's settings and Lead are checked again as the event is written). */
async function signoffWait(deps: LeadWakesDeps, wait: WaitingSignoff): Promise<void> {
  const t = await tenant(deps.db, wait.companyId);
  const flow = (await tasksRepo.flows.get(t, wait.flowId)) as Flow;
  const roster = await rosterOf(t);
  const wake = { flow, roster, taskId: wait.taskId, step: wait.stepName, reason: null };
  await recordWake(tasksRepo, t, { ...wake, kind: 'signoff_waiting' });
}

/**
 * One tick (see above). Both scans skip deleted companies; a company that goes while the tick runs fails it (logged,
 * tried again at the next tick).
 */
export async function wakeLeadsOnce(deps: LeadWakesDeps, now: Date = deps.clock()): Promise<WakeTick> {
  const waits = await waitingSignoffs(deps.db, now, WAKE_FLOWS_PER_TICK);
  for (const wait of waits) await signoffWait(deps, wait);
  const seen = await stampSeen(deps.db, now);
  const tally = {
    signoffs: waits.length,
    seen,
    woke: 0,
    capped: 0,
    unreachable: 0,
    dropped: 0,
    waiting: 0,
    none: 0,
  };
  for (const flow of await waitingFlows(deps.db, WAKE_FLOWS_PER_TICK)) {
    const t = await tenant(deps.db, flow.companyId);
    tally[await deliverFlow(deps, tasksRepo, t, flow.flowId, now)]++;
  }
  return tally;
}

/** The tick's loop in this process: `start` sets its first timer, `stop` clears it and waits for the tick in flight. */
export function leadWakes(deps: LeadWakesDeps & { readonly timers: Timers; readonly tickMs?: number }) {
  const tickMs = deps.tickMs ?? WAKE_TICK_MS;
  let timer: unknown;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();
  const schedule = () => {
    timer = deps.timers.setTimeout(tick, tickMs);
  };
  async function tick(): Promise<void> {
    inFlight = wakeLeadsOnce(deps).then(
      () => undefined,
      (error: unknown) => deps.logger.error({ err: error }, 'tasks: a Lead wake-up tick failed'),
    );
    await inFlight;
    if (!stopped) schedule();
  }
  return {
    start(): void {
      schedule();
    },
    async stop(): Promise<void> {
      stopped = true;
      deps.timers.clearTimeout(timer);
      await inFlight;
    },
  };
}

export type LeadWakes = ReturnType<typeof leadWakes>;
