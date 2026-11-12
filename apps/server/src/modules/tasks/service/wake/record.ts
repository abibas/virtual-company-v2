import type { Flow, TenantDb } from '@mwc/db';
import type { LeadEventKind } from '@mwc/shared/flows';
import type { TasksRepo } from '../../repo.ts';
import { wakeReason, wakesOn } from '../../rules/wake.ts';
import type { Roster } from '../team.ts';

/**
 * A task's event that may wake its flow's Lead (S6c, docs/processes.md "Built: the Lead wakes up"), written in the
 * transaction that made it (a move, a step's run, the tick's sign-off scan): only when the flow's Lead is an agent on the
 * chart and the flow's settings wake it for this kind. The tick tells it later, with the flow's other events.
 */

/** True when the flow's Lead is an agent on the chart (not a person, not archived). */
export const leadIsAgent = (roster: Roster, flow: Pick<Flow, 'leadPrincipalId'>): boolean =>
  roster.onChart(flow.leadPrincipalId) && !roster.isPerson(flow.leadPrincipalId);

export async function recordWake(
  repo: TasksRepo,
  tx: TenantDb,
  wake: {
    readonly flow: Flow;
    readonly roster: Roster;
    readonly taskId: string;
    readonly kind: LeadEventKind | undefined;
    readonly step: string | null;
    readonly reason: string | null;
  },
): Promise<void> {
  const { flow, kind } = wake;
  if (kind === undefined || !leadIsAgent(wake.roster, flow) || !wakesOn(flow, kind)) return;
  await repo.wakes.insert(tx, {
    flowId: flow.id,
    taskId: wake.taskId,
    kind,
    stepName: wake.step,
    reason: wakeReason(wake.reason),
  });
}
