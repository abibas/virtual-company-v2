import { type MembershipRole, TaskAction } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { type Refusal, refuse, type StepRule, type TaskNow } from '../rules.ts';
import { moveRefusal } from './moves.ts';

// Who may do what with a flow and its tasks (S5.3a; agents since S6a). Anyone of the company reads; members and up
// create tasks; a step's assignee, when a person, moves the task at their step; the Lead's people (the Lead when a
// person, and every person above it on the chart) and the company's admins and owners make any move and change the
// flow, each recorded as themselves. Agents act only through their tools: a flow's Lead agent creates tasks in its own
// flow and routes, starts, retries and cancels them there; a step's agent makes its step's moves on its own step, only
// as its turn's decision. People keep all their rights.

/**
 * How an agent acts (S6a): as the Lead of a flow, through its board tools in its own chats, or as a step's agent,
 * through the decision its step's turn recorded.
 */
export type AgentVia = 'lead' | 'decision';

/**
 * The caller, from the route's guard, or an agent acting through its tools (`agent`). An agent is no member: its `agent`
 * decides every rule here, and its `role` is `member` only so that no role check gives it more.
 */
export interface Caller {
  readonly principalId: string;
  readonly role: MembershipRole;
  readonly agent?: AgentVia | undefined;
}

/** A flow's team as the rules read it: its Lead, and the people who lead it (`peopleAtOrAbove` its Lead on the chart). */
export interface Team {
  readonly lead: string;
  readonly leadPeople: readonly string[];
}

/** The moves a Lead agent makes in its flow, and the moves a step's agent makes on its step (S6a). */
const LEAD_AGENT_MOVES: readonly TaskAction[] = ['route', 'start', 'retry', 'cancel'];
const STEP_AGENT_MOVES: readonly TaskAction[] = ['hand_on', 'pass', 'approve', 'send_back'];

/** True for the team's own Lead agent acting through its board tools. */
const isLeadAgent = (caller: Caller, team: Team) =>
  caller.agent === 'lead' && caller.principalId === team.lead;

/** True for a company admin or owner, or one of the team's Lead people; never for an agent. */
export const leads = (caller: Caller, team: Team): boolean =>
  caller.agent === undefined &&
  (roleAtLeast(caller.role, 'admin') || team.leadPeople.includes(caller.principalId));

/** True when a person may move a task at `step`: they lead the team, or the step is theirs. */
export const mayActAt = (caller: Caller, team: Team, step: StepRule | undefined): boolean =>
  leads(caller, team) ||
  (caller.agent === undefined && step !== undefined && step.assigneePrincipalId === caller.principalId);

const NOT_LEAD = refuse(
  403,
  'not_lead',
  "Only the team's Lead, a person above the Lead on the chart, or a company admin or owner may do this",
);
const NOT_YOUR_STEP = refuse(
  403,
  'not_your_step',
  "This step is not yours: only its assignee, the team's Lead people and the company's admins and owners move it",
);

/** The refusal when the caller may not change the flow (its steps, its name). Agents never do. */
export const leadRefusal = (caller: Caller, team: Team): Refusal<403> | undefined =>
  leads(caller, team) ? undefined : NOT_LEAD;

/** The refusal when the caller may not put a new task straight into a step: the Lead's people, admins, the Lead agent. */
export const intoStepRefusal = (caller: Caller, team: Team): Refusal<403> | undefined =>
  leads(caller, team) || isLeadAgent(caller, team) ? undefined : NOT_LEAD;

/** An agent's move (S6a): the Lead agent's in its flow, a step's agent's on its own step through its decision. */
function agentActRefusal(caller: Caller, team: Team, action: TaskAction, step: StepRule | undefined) {
  if (caller.agent === 'lead')
    return isLeadAgent(caller, team) && LEAD_AGENT_MOVES.includes(action) ? undefined : NOT_LEAD;
  const own = step !== undefined && step.assigneePrincipalId === caller.principalId;
  return own && STEP_AGENT_MOVES.includes(action) ? undefined : NOT_YOUR_STEP;
}

/** The refusal when the caller may not make `action` on a task at `step` (403 `not_lead`, `not_your_step`). */
export function actRefusal(
  caller: Caller,
  team: Team,
  action: TaskAction,
  step: StepRule | undefined,
): Refusal<403> | undefined {
  if (caller.agent !== undefined) return agentActRefusal(caller, team, action, step);
  if (action === 'route' || action === 'retry' || action === 'cancel') return leadRefusal(caller, team);
  return mayActAt(caller, team, step) ? undefined : NOT_YOUR_STEP;
}

/** The refusal when the caller may not edit a task: its creator, or whoever leads the team (people only). */
export const editRefusal = (caller: Caller, team: Team, createdBy: string): Refusal<403> | undefined =>
  (caller.agent === undefined && caller.principalId === createdBy) || leads(caller, team)
    ? undefined
    : refuse(403, 'not_yours', "Only the task's creator and whoever leads the team edit it");

/**
 * The moves the caller may make on the task now, for its page and `mwc task show`: those the task allows as it stands
 * (`moveRefusal`) and the caller is allowed. Viewers make none. A send-back still needs a reason and a route a step.
 */
export function allowedActions(
  caller: Caller,
  team: Team,
  task: TaskNow,
  current: StepRule | undefined,
): TaskAction[] {
  if (!roleAtLeast(caller.role, 'member')) return [];
  return TaskAction.options.filter(
    (action) =>
      moveRefusal(task, current, action) === undefined &&
      actRefusal(caller, team, action, current) === undefined,
  );
}
