import type { FlowStepKind, PrincipalKind, StepOnReturn, StepStarts } from '@mwc/shared/enums';
import { FLOW_STEPS_MAX } from '@mwc/shared/flows';
import type { Flow, StepInput } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { nodeName } from '../../../components/org/chart.ts';
import type { DrawnStep } from '../drawing/StepBox.tsx';

/**
 * The flow editor's draft (S5.3a): the step list being edited in place, saved as a whole with `PUT …/steps` (or
 * `POST …/flows` for a new flow). A step keeps its id, so the tasks at it stay with it wherever it moves; a send-back
 * points at a step by its key, so a rename keeps it, and it is written as the target's name when saved.
 */
export interface DraftStep {
  /** The step's id, or `new-<n>` for one not saved yet. */
  readonly key: string;
  readonly id: string | undefined;
  readonly name: string;
  readonly kind: FlowStepKind;
  readonly assignee: string;
  readonly starts: StepStarts;
  readonly onReturn: StepOnReturn;
  readonly sendsBackTo: string | null;
  readonly limit: number | null;
}

let fresh = 0;
const newKey = () => `new-${++fresh}`;

/** A flow's steps as a draft. */
export const draftOf = (flow: Flow): DraftStep[] =>
  flow.steps.map((step) => ({
    key: step.id,
    id: step.id,
    name: step.name,
    kind: step.kind,
    assignee: step.assignee.principalId,
    starts: step.starts,
    onReturn: step.onReturn,
    sendsBackTo: step.sendsBackToStepId,
    limit: step.sendBackLimit,
  }));

/** A new Work step for `assignee`, unnamed. */
export const newStep = (assignee: string): DraftStep => ({
  key: newKey(),
  id: undefined,
  name: '',
  kind: 'work',
  assignee,
  starts: 'manual',
  onReturn: 'keep',
  sendsBackTo: null,
  limit: null,
});

/** One step changed; a Work step sends nothing back, and a step's send-back targets stay earlier ones. */
export function changeStep(
  steps: readonly DraftStep[],
  key: string,
  change: Partial<DraftStep>,
): DraftStep[] {
  return steps.map((step) => {
    if (step.key !== key) return step;
    const next = { ...step, ...change };
    return next.kind === 'work' ? { ...next, sendsBackTo: null, limit: null } : next;
  });
}

/** A step removed; the steps that sent back to it send back nowhere (and keep no limit). */
export const removeStep = (steps: readonly DraftStep[], key: string): DraftStep[] =>
  steps
    .filter((step) => step.key !== key)
    .map((step) => (step.sendsBackTo === key ? { ...step, sendsBackTo: null, limit: null } : step));

/** The step at `from` moved to `to`. */
export function moveStep(steps: readonly DraftStep[], from: number, to: number): DraftStep[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return [...steps];
  const next = [...steps];
  const [step] = next.splice(from, 1);
  if (step) next.splice(to, 0, step);
  return next;
}

/** What is wrong with a step before the server is asked, in a few words, or undefined. */
export function problemOf(steps: readonly DraftStep[], index: number): string | undefined {
  const step = steps[index];
  if (!step) return undefined;
  const name = step.name.trim().toLowerCase();
  if (name === '') return 'Name it';
  if (steps.some((other, i) => i !== index && other.name.trim().toLowerCase() === name)) {
    return 'Another step has this name';
  }
  if (step.sendsBackTo !== null) {
    const target = steps.findIndex((other) => other.key === step.sendsBackTo);
    if (target < 0 || target >= index) return 'Sends back to a later step: pick an earlier one';
  }
  if (step.limit !== null && step.sendsBackTo === null) return 'A limit needs a step to send back to';
  return undefined;
}

/** True when the draft may be sent: some steps, at most the most a flow has, none with a problem. */
export const draftReady = (steps: readonly DraftStep[]): boolean =>
  steps.length > 0 &&
  steps.length <= FLOW_STEPS_MAX &&
  steps.every((_, i) => problemOf(steps, i) === undefined);

/** The draft as the API takes it: in order, each send-back by its target's name. */
export function toInput(steps: readonly DraftStep[]): StepInput[] {
  const names = new Map(steps.map((step) => [step.key, step.name.trim()]));
  return steps.map((step) => ({
    ...(step.id ? { id: step.id } : {}),
    name: step.name.trim(),
    kind: step.kind,
    assigneePrincipalId: step.assignee,
    starts: step.starts,
    onReturn: step.onReturn,
    sendsBackTo: step.sendsBackTo === null ? null : (names.get(step.sendsBackTo) ?? null),
    sendBackLimit: step.limit,
  }));
}

/** The draft as the drawing shows it (a preview while editing), with the assignees' names from the chart. */
export function drawnDraft(steps: readonly DraftStep[], nodes: ReadonlyMap<string, ChartNode>): DrawnStep[] {
  return steps.map((step) => {
    const node = nodes.get(step.assignee);
    const kind: PrincipalKind = node?.kind ?? 'agent';
    return {
      key: step.key,
      name: step.name.trim() || 'Unnamed',
      kind: step.kind,
      assignee: { principalId: step.assignee, kind, name: node ? nodeName(node) : 'Someone' },
      onReturn: step.onReturn,
      sendsBackTo: step.sendsBackTo,
      sendBackLimit: step.limit,
    };
  });
}
