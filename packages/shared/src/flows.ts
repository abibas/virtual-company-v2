import type { FlowStepKind, PrincipalKind, StepOnReturn } from './enums.ts';

/**
 * The flows' and tasks' contract (S5.3a, docs/processes.md): the limits the API's schemas and the database's CHECKs
 * share, a task's key, and a flow's written form, the text table people and agents read (the web, `mwc flow show` and,
 * from S6, the agents' tools write the same text). The enums are `flows/enums.ts`, re-exported by `@mwc/shared/enums`.
 */

export * from './flows/enums.ts';

/** A flow's name ("DEVBOX delivery"), after trimming. */
export const FLOW_NAME = { min: 1, max: 80 } as const;

/** A step's name ("Code review"), after trimming; unique in its flow, whatever the case. */
export const STEP_NAME = { min: 1, max: 60 } as const;

/** The most steps a flow has. */
export const FLOW_STEPS_MAX = 20;

/** A Check or Sign-off step's send-back limit: after this many send-backs the task goes to the Lead. */
export const SEND_BACK_LIMIT = { min: 1, max: 99 } as const;

/** A task's title, after trimming. */
export const TASK_TITLE = { min: 1, max: 200 } as const;

/** A task's description, markdown. */
export const TASK_DESCRIPTION_MAX = 50_000;

/** A move's reason: why a task was sent back, cancelled or routed. */
export const TASK_REASON_MAX = 2_000;

/** How many done tasks the board shows (the latest), unless asked for fewer or more. */
export const BOARD_DONE = { default: 10, max: 50 } as const;

/** A page of the task list. */
export const TASK_PAGE = { default: 50, max: 200 } as const;

/** A task's key in its company: `T-` and its number. */
export const taskKey = (number: number): string => `T-${number}`;

/** The number of a task key (`T-12`, any case), or undefined for anything else. */
export function taskNumber(key: string): number | undefined {
  const match = /^t-([1-9]\d{0,8})$/i.exec(key.trim());
  return match ? Number(match[1]) : undefined;
}

/** One step as the written form reads it. */
export interface WrittenStep {
  readonly name: string;
  readonly kind: FlowStepKind;
  /** The assignee's name. */
  readonly who: string;
  /** A person keeps no conversation, so a person's step shows a dash for "comes back again". */
  readonly whoKind: PrincipalKind;
  readonly onReturn: StepOnReturn;
  /** The step's send-back target, by name. */
  readonly sendsBackTo: string | null;
  readonly sendBackLimit: number | null;
}

/** A flow as the written form reads it: its name, its Lead's name and its steps in order. */
export interface WrittenFlow {
  readonly name: string;
  readonly lead: string;
  readonly steps: readonly WrittenStep[];
}

const KIND_WORDS: Readonly<Record<FlowStepKind, string>> = {
  work: 'Work',
  check: 'Check',
  signoff: 'Sign-off',
};
const RETURN_WORDS: Readonly<Record<StepOnReturn, string>> = { keep: 'Keep', fresh: 'Fresh' };
const DASH = '—';
const HEADER = ['Step', 'Kind', 'Who', 'Comes back again', 'Sends back to', 'Limit'] as const;
/** Spaces between two columns. */
const GAP = 3;

/** A step's cells, in the header's order. */
function cells(step: WrittenStep): string[] {
  return [
    step.name,
    KIND_WORDS[step.kind],
    step.who,
    step.whoKind === 'person' ? DASH : RETURN_WORDS[step.onReturn],
    step.sendsBackTo ?? DASH,
    step.sendBackLimit === null ? DASH : `${step.sendBackLimit} → Lead`,
  ];
}

/**
 * A flow's written form (docs/processes.md, "How a flow is written and drawn"): `Flow: <name> · Lead: <lead>`, a blank
 * line, the steps as a table whose columns are as wide as their widest cell and three spaces, and `→ Done`. A person's
 * step shows a dash for "comes back again"; no send-back target or no limit shows a dash too. No line ends in spaces.
 */
export function flowText(flow: WrittenFlow): string {
  const rows = [[...HEADER], ...flow.steps.map(cells)];
  const widths = HEADER.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  const line = (row: readonly string[]) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd((widths[column] ?? 0) + GAP)))
      .join('');
  return [`Flow: ${flow.name} · Lead: ${flow.lead}`, '', ...rows.map(line), '→ Done', ''].join('\n');
}
