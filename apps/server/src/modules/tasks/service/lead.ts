import type { Flow, FlowStep, TenantDb } from '@mwc/db';
import { type AGENT_TOOL_INPUTS, LEAD_ACTIONS, type LEAD_TOOLS, taskNumber } from '@mwc/shared/flows';
import type { z } from 'zod';
import type { AgentToolTurn } from '../../chats/index.ts';
import type { TasksRepo } from '../repo.ts';
import { boardText, createdText, movedText, taskText } from '../rules/tool-text.ts';
import { actOnTask } from './actions.ts';
import type { Caller } from './audit.ts';
import { boardOf } from './board.ts';
import type { ToolReply } from './decision.ts';
import type { RunDeps } from './runs.ts';
import { createTask, shownTask } from './tasks.ts';

/**
 * A flow Lead's tools in its own chats (S6a, docs/processes.md "Built in S6a"): the board, a task, a new task, and the
 * moves `route`, `start`, `retry` and `cancel`, applied at once as the S5.3a actions are, acting as the Lead agent (its
 * history rows and audit rows name it; a step that starts by itself runs as it). Only its own flow: a task of another
 * flow is not found. Every rule of the moves holds (a move while the task's turn runs is refused, never forced).
 */

type LeadTool = (typeof LEAD_TOOLS)[number];
type Input<T extends LeadTool> = z.infer<(typeof AGENT_TOOL_INPUTS)[T]>;

/** The Lead agent acting through its board tools. */
export const leading = (turn: Pick<AgentToolTurn, 'agentPrincipalId' | 'turnId'>): Caller => ({
  principalId: turn.agentPrincipalId,
  role: 'member',
  requestId: turn.turnId,
  agent: 'lead',
});

const NO_FLOW = "You lead no flow: these tools work in a flow Lead's own chats only.";

/** A step of the flow by its name (any case) or id; undefined for none. */
const stepNamed = (steps: readonly FlowStep[], ref: string) =>
  steps.find((step) => step.id === ref || step.name.toLowerCase() === ref.trim().toLowerCase());

/** Why a step was not found: the names it could be. */
const noStep = (ref: string, steps: readonly FlowStep[]): ToolReply => ({
  ok: false,
  text: `No step "${ref}" in your flow; its steps: ${steps.map((step) => `"${step.name}"`).join(', ')}.`,
});

/** The task of the Lead's flow with this key; a task of another flow is as none. */
async function inFlow(repo: TasksRepo, t: TenantDb, flow: Flow, key: string) {
  const task = await repo.tasks.get(t, { number: taskNumber(key) as number });
  return task?.flowId === flow.id ? task : undefined;
}

/** `task_create`: queued, or into a step of the flow (which starts it when the step starts by itself). */
async function create(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  flow: Flow,
  input: Input<'task_create'>,
  now: Date,
) {
  const steps = await repo.flows.steps(t, flow.id);
  const step = input.step === undefined ? undefined : stepNamed(steps, input.step);
  if (input.step !== undefined && step === undefined) return noStep(input.step, steps);
  const made = await createTask(deps, repo, t, caller, {
    flowId: flow.id,
    title: input.title,
    description: input.description,
    priority: input.priority,
    stepId: step?.id,
    now,
  });
  return made.ok ? { ok: true, text: createdText(made.task) } : { ok: false, text: made.message };
}

/** One call of a Lead's tool (see above). */
export async function leadTool(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  turn: AgentToolTurn,
  call: { readonly tool: LeadTool; readonly input: unknown; readonly now: Date },
): Promise<ToolReply> {
  const flow = await repo.flows.byLead(t, turn.agentPrincipalId);
  if (flow === undefined) return { ok: false, text: NO_FLOW };
  const caller = leading(turn);
  const { tool, now } = call;
  if (tool === 'team_board') return { ok: true, text: boardText(await boardOf(deps, repo, t, flow)) };
  if (tool === 'task_create')
    return create(deps, repo, t, caller, flow, call.input as Input<'task_create'>, now);
  const input = call.input as Input<'task_show'> & { step?: string; reason?: string };
  const task = await inFlow(repo, t, flow, input.key);
  if (task === undefined)
    return { ok: false, text: `No task ${input.key.toUpperCase()} in your flow "${flow.name}".` };
  if (tool === 'task_show') return { ok: true, text: taskText(await shownTask(deps, repo, t, caller, task)) };
  let toStepId: string | undefined;
  if (input.step !== undefined) {
    const steps = await repo.flows.steps(t, flow.id);
    toStepId = stepNamed(steps, input.step)?.id;
    if (toStepId === undefined) return noStep(input.step, steps);
  }
  const body = { action: LEAD_ACTIONS[tool], toStepId, reason: input.reason, fromStepId: task.currentStepId };
  const done = await actOnTask(deps, repo, t, caller, { ref: { id: task.id }, body, now });
  return done.ok ? { ok: true, text: movedText(done.outcome, done.task) } : { ok: false, text: done.message };
}
