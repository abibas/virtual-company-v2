import type { FlowStepKind, StepOnReturn, StepStarts } from '@mwc/shared/enums';
import { FLOW_STEPS_MAX } from '@mwc/shared/flows';
import { type Refusal, refuse } from '../rules.ts';

// A flow's step list (docs/processes.md, "Per step"), edited as a whole: the list a person sends checked and turned
// into the steps to write. Steps keep their ids (an item names the step it is by `id`), so tasks at a step stay with
// it whatever the order; a step left out of the list is removed, which the service refuses while a task is at it.

/** One step of the list as the API takes it; `sendsBackTo` names an earlier step of the same list. */
export interface StepInput {
  /** The step it is: one of this flow's steps; none for a new step. */
  readonly id?: string | undefined;
  readonly name: string;
  readonly kind: FlowStepKind;
  readonly assigneePrincipalId: string;
  readonly starts?: StepStarts | undefined;
  readonly onReturn?: StepOnReturn | undefined;
  readonly sendsBackTo?: string | null | undefined;
  readonly sendBackLimit?: number | null | undefined;
}

/** A step to write: its place in the list (from 1) and its send-back target as an index into the list. */
export interface PlannedStep {
  readonly id: string | undefined;
  readonly position: number;
  readonly name: string;
  readonly kind: FlowStepKind;
  readonly assigneePrincipalId: string;
  readonly starts: StepStarts;
  readonly onReturn: StepOnReturn;
  /** The index in `steps` of the target; null for none. */
  readonly sendsBackTo: number | null;
  readonly sendBackLimit: number | null;
}

/** The list checked: the steps in order, and the ids of this flow's steps it leaves out (removed). */
export interface StepPlan {
  readonly ok: true;
  readonly steps: readonly PlannedStep[];
  readonly removed: readonly string[];
}

/** What a step list is checked against. */
export interface StepContext {
  /** This flow's steps now, by id; none for a new flow. */
  readonly existing: ReadonlySet<string>;
  /** True for a principal on the company's chart: an active member, or an agent not archived. */
  readonly onChart: (principalId: string) => boolean;
}

const invalid = (code: string, message: string) => refuse(422, code, message);

/** Why the list as a whole is refused: empty, too long, a name or an id twice, an id of no step of this flow. */
function listRefusal(items: readonly StepInput[], existing: ReadonlySet<string>): Refusal<422> | undefined {
  if (items.length === 0) return invalid('no_steps', 'A flow needs at least one step');
  if (items.length > FLOW_STEPS_MAX) {
    return invalid('too_many_steps', `A flow has at most ${FLOW_STEPS_MAX} steps`);
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const item of items) {
    const name = item.name.trim().toLowerCase();
    if (names.has(name)) {
      return invalid(
        'duplicate_step_name',
        `Two steps are called "${item.name.trim()}"; each needs its own name`,
      );
    }
    names.add(name);
    if (item.id === undefined) continue;
    if (!existing.has(item.id) || ids.has(item.id)) {
      return invalid('unknown_step', `"${item.name.trim()}" names a step this flow does not have (or twice)`);
    }
    ids.add(item.id);
  }
  return undefined;
}

/** Why one step is refused: its assignee, or its send-back target or limit; undefined when it is fine. */
function stepRefusal(
  items: readonly StepInput[],
  index: number,
  onChart: (principalId: string) => boolean,
): Refusal<422> | undefined {
  const item = items[index] as StepInput;
  const name = item.name.trim();
  if (!onChart(item.assigneePrincipalId)) {
    return invalid(
      'assignee_not_found',
      `"${name}" is assigned to someone who is not an active person or agent of this company`,
    );
  }
  const target = item.sendsBackTo ?? null;
  const limit = item.sendBackLimit ?? null;
  if (item.kind === 'work' && (target !== null || limit !== null)) {
    return invalid('work_sends_back', `"${name}" is a Work step: only Check and Sign-off steps send back`);
  }
  if (target === null) {
    return limit === null
      ? undefined
      : invalid('bad_send_back', `"${name}" has a send-back limit but no step to send back to`);
  }
  const at = targetIndex(items, target);
  if (at === undefined || at >= index) {
    return invalid('bad_send_back', `"${name}" sends back to "${target}", which is not a step before it`);
  }
  return undefined;
}

/** The index of the step named `name` (any case, trimmed), or undefined. */
function targetIndex(items: readonly StepInput[], name: string): number | undefined {
  const wanted = name.trim().toLowerCase();
  const index = items.findIndex((item) => item.name.trim().toLowerCase() === wanted);
  return index < 0 ? undefined : index;
}

/**
 * Checks a flow's step list and plans it, or refuses it (422) with the first problem, by code: no steps
 * (`no_steps`), more than `FLOW_STEPS_MAX` (`too_many_steps`), two names alike whatever the case
 * (`duplicate_step_name`), an id of no step of this flow or one id twice (`unknown_step`), an assignee who is not an
 * active member or an agent not archived (`assignee_not_found`), a Work step with a send-back target or limit
 * (`work_sends_back`), a target that is not an earlier step or a limit without a target (`bad_send_back`). Names are
 * trimmed; a step starts manually and keeps its conversation unless the item says otherwise.
 */
export function planSteps(items: readonly StepInput[], context: StepContext): StepPlan | Refusal<422> {
  const refusal = listRefusal(items, context.existing);
  if (refusal) return refusal;
  for (let index = 0; index < items.length; index++) {
    const stepRefused = stepRefusal(items, index, context.onChart);
    if (stepRefused) return stepRefused;
  }
  const steps = items.map((item, index) => ({
    id: item.id,
    position: index + 1,
    name: item.name.trim(),
    kind: item.kind,
    assigneePrincipalId: item.assigneePrincipalId,
    starts: item.starts ?? 'manual',
    onReturn: item.onReturn ?? 'keep',
    sendsBackTo: item.sendsBackTo == null ? null : (targetIndex(items, item.sendsBackTo) as number),
    sendBackLimit: item.sendBackLimit ?? null,
  }));
  const kept = new Set(items.flatMap((item) => (item.id === undefined ? [] : [item.id])));
  return { ok: true, steps, removed: [...context.existing].filter((id) => !kept.has(id)) };
}
