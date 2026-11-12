import type { TenantDb } from '@mwc/db';
import {
  AgentTool,
  type AttachInput,
  checkToolInput,
  isDecisionTool,
  LEAD_TOOLS,
  leadSection,
  stepTools,
} from '@mwc/shared/flows';
import type { AgentToolsPlan, AgentToolTurn, TaskTurnContext, TaskTurnDraft } from '../../chats/index.ts';
import type { TurnToolCall } from '../../machines/index.ts';
import type { TasksRepo } from '../repo.ts';
import { decisionInput } from '../rules/decision.ts';
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
    return { tools: step === undefined ? [] : stepTools(step.kind) };
  }
  const flow = await repo.flows.byLead(t, turn.agentPrincipalId);
  return flow === undefined
    ? { tools: [] }
    : { tools: [...LEAD_TOOLS], instructions: leadSection(flow.name) };
}

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
