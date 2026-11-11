import { type MembershipRole, TaskAction } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { type Refusal, refuse, type StepRule, type TaskNow } from '../rules.ts';
import { moveRefusal } from './moves.ts';

// Who may do what with a flow and its tasks while agents have no tools (S5.3a, until S6): people only. Anyone of the
// company reads; members and up create tasks; a step's assignee, when a person, moves the task at their step; the
// Lead's people (the Lead when a person, and every person above it on the chart) and the company's admins and owners
// make any move and change the flow, each recorded as themselves.

/** The caller, from the route's guard. */
export interface Caller {
  readonly principalId: string;
  readonly role: MembershipRole;
}

/** A flow's team as the rules read it: the people who lead it (`peopleAtOrAbove` its Lead on the chart). */
export interface Team {
  readonly leadPeople: readonly string[];
}

/** True for a company admin or owner, or one of the team's Lead people. */
export const leads = (caller: Caller, team: Team): boolean =>
  roleAtLeast(caller.role, 'admin') || team.leadPeople.includes(caller.principalId);

/** True when the caller may move a task at `step`: they lead the team, or the step is theirs. */
export const mayActAt = (caller: Caller, team: Team, step: StepRule | undefined): boolean =>
  leads(caller, team) || (step !== undefined && step.assigneePrincipalId === caller.principalId);

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

/** The refusal when the caller may not change the flow (its steps, its name) or put a task into a step. */
export const leadRefusal = (caller: Caller, team: Team): Refusal<403> | undefined =>
  leads(caller, team) ? undefined : NOT_LEAD;

/** The refusal when the caller may not make `action` on a task at `step` (403 `not_lead`, `not_your_step`). */
export function actRefusal(
  caller: Caller,
  team: Team,
  action: TaskAction,
  step: StepRule | undefined,
): Refusal<403> | undefined {
  if (action === 'route' || action === 'retry' || action === 'cancel') return leadRefusal(caller, team);
  return mayActAt(caller, team, step) ? undefined : NOT_YOUR_STEP;
}

/** The refusal when the caller may not edit a task: its creator, or whoever leads the team. */
export const editRefusal = (caller: Caller, team: Team, createdBy: string): Refusal<403> | undefined =>
  caller.principalId === createdBy || leads(caller, team)
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
