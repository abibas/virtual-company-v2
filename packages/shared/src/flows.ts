import type { FlowStepKind, PrincipalKind, StepOnReturn } from './enums.ts';

/**
 * The flows' and tasks' contract (S5.3a, docs/processes.md): the limits the API's schemas and the database's CHECKs
 * share, a task's key (`flows/keys.ts`), and a flow's written form, the text table people and agents read (the web,
 * `mwc flow show`, a step's prompt and, from S6, the agents' tools write the same text). The enums are `flows/enums.ts`,
 * re-exported by `@mwc/shared/enums`, and the limits are `flows/limits.ts`; a step's run (S5.3b) adds its prompt
 * (`flows/prompt.ts`) and its artifacts (`flows/artifacts.ts`), S6a the agents' tools (`flows/tools.ts`, with their
 * input check `flows/tool-input.ts` and words `flows/tool-words.ts`) and S6c the Lead's wake-ups (`flows/wake.ts`).
 */

export * from './flows/artifacts.ts';
export * from './flows/enums.ts';
export * from './flows/keys.ts';
export * from './flows/limits.ts';
export * from './flows/prompt.ts';
export * from './flows/tool-input.ts';
export * from './flows/tool-words.ts';
export * from './flows/tools.ts';
export * from './flows/wake.ts';

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
