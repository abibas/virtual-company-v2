import type { Flow, FlowStep, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import type { TasksRepo } from '../repo.ts';
import type { StepPlan } from '../rules/steps.ts';
import { type Refusal, refuse } from '../rules.ts';
import { audit, type Caller } from './audit.ts';

/**
 * Writing a flow's checked step list (`planSteps`) in the caller's transaction, under the flow's lock: steps named by
 * id keep it (and the tasks at them), new ones are made, and the ones left out are removed, refused while a task is at
 * one or a retry would send one there (409 `step_has_tasks`, naming them: route them elsewhere first). Positions are
 * moved out of the way first so the new order never puts two steps at one place, and send-back targets are written
 * last, once every step has its id. Every changed field is audited.
 */

/** Far enough down that no list's positions (at most a few dozen) meet the parked ones. */
const PARKED = 1_000;

export async function writeSteps(
  repo: TasksRepo,
  tx: TenantDb,
  caller: Caller,
  change: { readonly flow: Flow; readonly before: readonly FlowStep[]; readonly plan: StepPlan },
): Promise<{ readonly ok: true; readonly steps: FlowStep[] } | Refusal<409>> {
  const { flow, before, plan } = change;
  const busy = await repo.flows.tasksAt(tx, plan.removed);
  if (busy.length > 0) {
    const keys = busy.map(taskKey).join(', ');
    return refuse(
      409,
      'step_has_tasks',
      `A step left out has open tasks (${keys}); route them to another step first`,
    );
  }
  await repo.flows.parkPositions(tx, flow.id, PARKED);
  await repo.flows.clearTargets(tx, flow.id);
  await repo.flows.deleteSteps(tx, plan.removed);
  const ids: string[] = [];
  for (const planned of plan.steps) {
    const { id, sendsBackTo: _target, ...fields } = planned;
    const row =
      id === undefined
        ? await repo.flows.insertStep(tx, { ...fields, flowId: flow.id })
        : await repo.flows.updateStep(tx, id, fields);
    ids.push(row.id);
  }
  for (const [index, planned] of plan.steps.entries()) {
    if (planned.sendsBackTo === null) continue;
    await repo.flows.updateStep(tx, ids[index] as string, { sendsBackToStepId: ids[planned.sendsBackTo] });
  }
  const after = await repo.flows.steps(tx, flow.id);
  await auditSteps(repo, tx, caller, before, after);
  return { ok: true, steps: after };
}

/** One audit row per changed field of each step: `create`, `update` or `delete`. */
async function auditSteps(
  repo: TasksRepo,
  tx: TenantDb,
  caller: Caller,
  before: readonly FlowStep[],
  after: readonly FlowStep[],
): Promise<void> {
  const was = new Map(before.map((step) => [step.id, step]));
  const now = new Map(after.map((step) => [step.id, step]));
  for (const step of after) {
    const old = was.get(step.id);
    const action = old === undefined ? 'create' : 'update';
    await audit(repo, tx, caller, {
      entityType: 'flow_step',
      entityId: step.id,
      action,
      before: old,
      after: step,
    });
  }
  for (const step of before) {
    if (now.has(step.id)) continue;
    await audit(repo, tx, caller, {
      entityType: 'flow_step',
      entityId: step.id,
      action: 'delete',
      before: step,
    });
  }
}
