import { diffFields, type Flow, type FlowStep, type Task, type TenantDb } from '@mwc/db';
import type { TaskTurnContext } from '../../chats/index.ts';
import { principalNames } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import { actRefusal } from '../rules/access.ts';
import {
  type DecisionInput,
  decidedBlock,
  decisionAnswer,
  decisionFailed,
  decisionOf,
  decisionRow,
  previewDecision,
  stepToolRefusal,
} from '../rules/decision.ts';
import { move, type Transition } from '../rules/machine.ts';
import { moveRefusal } from '../rules/moves.ts';
import { applyMove } from './apply.ts';
import { AUDIT_IGNORED, type Caller } from './audit.ts';
import { applyStepChange, type RunDeps, runStep, startedNow } from './runs.ts';
import { rosterOf } from './team.ts';

/**
 * A step's turn's decision (S6a, docs/processes.md "Built in S6a"): a decision tool records the move on the task
 * (`tasks.decision`), checked again here (the turn is the task's step turn, its agent is the step's assignee, the task
 * is still at the step, the move is one of the step's kind and of the task as it stands), and answers what it will
 * make; a second call replaces it. When the turn ends done, the decision is applied as the step's agent (its history
 * rows and audit rows name the agent; a step that starts by itself runs next as it), in place of
 * `ended_without_handoff`; a turn that fails or is stopped drops it (the hook).
 */

/** A tool's answer: what happened, or why not, in words for the agent. */
export interface ToolReply {
  readonly ok: boolean;
  readonly text: string;
}

/** The step's agent acting through its turn's decision. */
export const deciding = (turn: Pick<TaskTurnContext, 'agentPrincipalId' | 'turnId'>): Caller => ({
  principalId: turn.agentPrincipalId,
  role: 'member',
  requestId: turn.turnId,
  agent: 'decision',
});

/** Who a run's change names: the agent, its turn as the request. */
const turnBy = (caller: Caller) => ({ principalId: caller.principalId, requestId: caller.requestId });

/** The task's step under the flow's and the task's locks, in `tx`. */
async function locked(repo: TasksRepo, tx: TenantDb, taskId: string) {
  const task = (await repo.tasks.get(tx, { id: taskId })) as Task;
  const flow = (await repo.flows.lock(tx, task.flowId)) as Flow;
  const now = await repo.tasks.lock(tx, task.id);
  const steps = await repo.flows.steps(tx, flow.id);
  return { flow, task: now, steps };
}

/** Records the turn's decision (see above); refused in words when the turn may not make it now. */
export async function recordDecision(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  turn: TaskTurnContext,
  call: { readonly tool: string; readonly decision: DecisionInput; readonly now: Date },
): Promise<ToolReply> {
  const task = await repo.tasks.get(t, { id: turn.taskId });
  const flow = task && (await repo.flows.get(t, task.flowId));
  const lead = flow && (await principalNames(deps.db, t, [flow.leadPrincipalId]))(flow.leadPrincipalId).name;
  return t.transaction(async (tx): Promise<ToolReply> => {
    const { task: now, steps } = await locked(repo, tx, turn.taskId);
    const step = steps.find((s) => s.id === turn.stepId);
    const refused = stepToolRefusal(now, step, turn, call.tool);
    if (refused) return { ok: false, text: refused.message };
    const roster = await rosterOf(tx);
    const preview = previewDecision(now, steps, call.decision, roster.isPerson);
    if ('ok' in preview) return { ok: false, text: `${preview.message}: nothing was recorded.` };
    const replaced = decisionOf(now, turn.turnId)?.action ?? null;
    const decision = decisionRow(turn, turn.agentPrincipalId, call.decision, preview, call.now);
    const after = await repo.tasks.update(tx, now.id, { decision });
    await repo.audit(tx, {
      actorKind: 'agent',
      actorPrincipalId: turn.agentPrincipalId,
      requestId: turn.turnId,
      entityType: 'task',
      entityId: now.id,
      action: 'decide',
      changes: diffFields(now, after, { ignore: AUDIT_IGNORED }),
    });
    const context = { task: now, step: step as FlowStep, lead: lead ?? 'the Lead' };
    return { ok: true, text: decisionAnswer(context, call.decision, preview, replaced) };
  });
}

/**
 * Applies the turn's decision when it ended done (see above), under the flow's and the task's locks: nothing unless the
 * task still holds this turn's decision at its step. A move the task no longer allows (its flow changed meanwhile)
 * leaves it `ended_without_handoff`, saying why. Whatever happens, the decision goes.
 */
export async function applyDecision(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  turn: TaskTurnContext,
  now: Date,
): Promise<void> {
  const caller = deciding(turn);
  const moved = await t.transaction(async (tx): Promise<Transition | undefined> => {
    const { flow, task, steps } = await locked(repo, tx, turn.taskId);
    const decision = decisionOf(task, turn.turnId);
    const step = steps.find((s) => s.id === decision?.stepId);
    if (decision === undefined || step === undefined || task.currentStepId !== step.id) return undefined;
    const roster = await rosterOf(tx);
    const write = (change: Parameters<typeof applyStepChange>[2]['change']) =>
      applyStepChange(repo, tx, { task, flow, step, change, by: { ...turnBy(caller), agent: true } });
    if (decision.action === 'blocked') {
      const change = decidedBlock(task, step, decision.reason ?? 'The agent cannot go on');
      if (change) await write(change);
      return undefined;
    }
    const input = { action: decision.action, reason: decision.reason ?? undefined };
    const refused =
      moveRefusal(task, step, input.action) ??
      actRefusal(caller, roster.team(flow.leadPrincipalId), input.action, step);
    const transition = refused ?? move(task, steps, input, roster.isPerson);
    if (!transition.ok) {
      await write(decisionFailed(task, step, decision, transition.message));
      return undefined;
    }
    const moving = { task, flow, from: step, roster, transition, action: input.action, now };
    await applyMove(repo, tx, caller, moving);
    return transition;
  });
  if (moved && startedNow(moved)) await runStep(deps, repo, t, caller, turn.taskId);
}

/** Drops this turn's decision without applying it (its turn failed, or was stopped, or another turn runs at the step). */
export async function dropDecision(repo: TasksRepo, t: TenantDb, turn: TaskTurnContext): Promise<void> {
  await t.transaction(async (tx) => {
    const { task } = await locked(repo, tx, turn.taskId);
    if (decisionOf(task, turn.turnId) === undefined) return;
    await repo.tasks.update(tx, task.id, { decision: null });
  });
}
