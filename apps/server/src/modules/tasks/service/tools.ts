import type { TenantDb } from '@mwc/db';
import {
  AgentTool,
  type AttachInput,
  CLOSED_TOOLS,
  checkToolInput,
  isDecisionTool,
  LEAD_TOOLS,
  leadSection,
  stepTools,
  taskKey,
} from '@mwc/shared/flows';
import type { AgentToolsPlan, AgentToolTurn, TaskTurnContext, TaskTurnDraft } from '../../chats/index.ts';
import type { TurnToolCall } from '../../machines/index.ts';
import type { TasksRepo } from '../repo.ts';
import { closedHere, decisionInput } from '../rules/decision.ts';
import { closedFromOf } from '../rules/machine.ts';
import { recordDecision, type ToolReply } from './decision.ts';
import { leadTool } from './lead.ts';
import type { RunDeps } from './runs.ts';
import { attachTo, readTask } from './step-tools.ts';

/**
 * The agents' tools on the server (S6a, docs/processes.md "Built in S6a"): which a turn gets (a task step's turn its
 * kind's, a flow Lead's own chat the board tools, any other turn none), and each call, checked again whatever the
 * runner checked: the tool must be one the turn gets, its input valid, and its rules hold (`decision.ts`,
 * `step-tools.ts`, `lead.ts`). A refusal is a tool error in words the agent can act on.
 */

type LeadTool = (typeof LEAD_TOOLS)[number];
const isLeadTool = (tool: AgentTool): tool is LeadTool => (LEAD_TOOLS as readonly string[]).includes(tool);

/** The tools a turn of this chat gets (see above). */
export async function toolsFor(
  repo: TasksRepo,
  t: TenantDb,
  turn: { readonly agentPrincipalId: string; readonly task?: TaskTurnDraft },
): Promise<AgentToolsPlan> {
  if (turn.task !== undefined) {
    const task = await repo.tasks.get(t, { id: turn.task.taskId });
    const step = task && (await repo.flows.steps(t, task.flowId)).find((s) => s.id === turn.task?.stepId);
    if (task === undefined || step === undefined) return { tools: [] };
    const closed = task.state === 'done' || task.state === 'cancelled';
    const closedFrom = closed ? closedFromOf(await repo.tasks.events(t, task.id)) : null;
    const ref = { stepId: step.id, agentPrincipalId: turn.agentPrincipalId };
    if (closedHere(task, step, ref, closedFrom))
      return { tools: [...CLOSED_TOOLS], instructions: closedSection(taskKey(task.number), task.state) };
    return { tools: stepTools(step.kind) };
  }
  const flow = await repo.flows.byLead(t, turn.agentPrincipalId);
  if (flow === undefined) return { tools: [] };
  const into = flow.newTaskStepId === null ? undefined : await repo.flows.steps(t, flow.id);
  const stepName = into?.find((step) => step.id === flow.newTaskStepId)?.name ?? null;
  const newTasks = { stepName, autoTake: flow.newTaskAutoTake };
  return { tools: [...LEAD_TOOLS], instructions: leadSection(flow.name, newTasks) };
}

/**
 * The standing instructions of the conversation a task was closed in (T-28): a correction reopens it, never a new task,
 * and is never made here (T-29: the sign-off agent built one itself when its runner lacked task_reopen).
 */
const closedSection = (key: string, state: string) =>
  [
    '## This task is closed (from Most Wanted)',
    '',
    `${key} is ${state}. If the person says here that it is wrong or asks for a change to it, call task_reopen ` +
      '{reason, findings: their correction, in full} and end your turn: the task goes back to the step your step ' +
      'sends back to as a new round, in that step’s same conversation, and comes back to you after. Never file a ' +
      'new task for a correction of this one, and never tell the person to file one.',
    '',
    'Never make the correction yourself, even when the person says "fix it": no code, file or deploy changes for ' +
      'it. The step that does the work makes it, and you sign it off again when it comes back. If you have no ' +
      'task_reopen tool, change nothing: say so, put their correction in your reply, and tell them to reopen it ' +
      'with Reopen… on the task page (its runner needs an update).',
  ].join('\n');

/** One call of a turn's tool (see above). */
export async function callTool(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  turn: AgentToolTurn,
  call: TurnToolCall,
  now: Date,
): Promise<ToolReply> {
  const known = AgentTool.safeParse(call.tool);
  if (!known.success) return { ok: false, text: `Unknown tool: ${call.tool}` };
  const tool = known.data;
  const lead = isLeadTool(tool);
  if (lead && turn.task !== undefined)
    return {
      ok: false,
      text: `${tool} works only in your own chats as a flow's Lead, not in a task's step.`,
    };
  if (!lead && turn.task === undefined)
    return { ok: false, text: `${tool} works only in a task step's turn.` };
  const checked = checkToolInput(tool, call.input);
  if (!checked.ok) return { ok: false, text: checked.error };
  const input = checked.input;
  if (isLeadTool(tool)) return leadTool(deps, repo, t, turn, { tool, input, now });
  const step = turn.task as TaskTurnContext;
  if (isDecisionTool(tool)) {
    const decision = decisionInput(tool, input as Parameters<typeof decisionInput>[1]);
    return recordDecision(deps, repo, t, step, { tool, decision, now });
  }
  if (tool === 'task_attach') return attachTo(repo, t, step, input as AttachInput, call.file);
  return readTask(deps, repo, t, step);
}
