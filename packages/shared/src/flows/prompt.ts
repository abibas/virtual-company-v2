import { CHAT_PROMPT } from '../chats.ts';
import { ARTIFACT_LIMITS } from './artifacts.ts';
import type { FlowStepKind, TaskArtifactKind } from './enums.ts';

/**
 * A step's prompt (S5.3b, docs/processes.md "Built in S5.3b"): what an agent at a step of a task's flow is told when its
 * turn starts. Pure, so the server writes it and the tests read it; short, and always within a chat prompt's 20 000
 * characters (the task's description gives way first). The full prompt holds the task, the flow in its written form with
 * the step it is at, what the step's kind asks for and how to answer, the hand-off (how the task came, the reason and
 * findings of a send-back, the last reply of the step it came from, the task's artifacts) and where to put outputs. A
 * conversation that continues (Keep) gets only what is new: the hand-off since its last round.
 */

/** How a task came to the step this time (the history row that brought it), or `new` for none before it. */
export type ArrivalKind = 'new' | 'handed_on' | 'passed' | 'signed_off' | 'sent_back' | 'routed' | 'retried';

/** One artifact as a prompt lists it. */
export interface PromptArtifact {
  /** The step's folder name (`1-develop`). */
  readonly step: string;
  readonly round: number;
  readonly name: string;
  readonly kind: TaskArtifactKind;
  readonly size: number;
}

/** What the step is handed. */
export interface StepHandoff {
  readonly arrival: {
    readonly kind: ArrivalKind;
    /** The step it came from, by name; null for none. */
    readonly from: string | null;
    /** A send-back's findings, a route's or a retry's reason; null for none. */
    readonly reason: string | null;
  };
  /** The last reply of the step it came from (its hand-off note); null for none. */
  readonly reply: string | null;
  /** The artifacts to list: all of the task's in a full prompt, those since the step's last round in a delta. */
  readonly artifacts: readonly PromptArtifact[];
}

export interface StepPromptInput {
  readonly task: { readonly key: string; readonly title: string; readonly description: string };
  /** The flow's written form (`flowText`). */
  readonly flowText: string;
  readonly step: { readonly name: string; readonly kind: FlowStepKind; readonly position: number };
  /** The next step's name; null when this step's outcome closes the task. */
  readonly next: string | null;
  /** Where a Check or Sign-off sends the task back to, by name; null for none. */
  readonly sendsBackTo: string | null;
  readonly round: number;
  /** Where the round's outputs go, relative to the agent's home folder (`artifactsFolder`). */
  readonly folder: string;
  readonly handoff: StepHandoff;
}

/** The longest prompt: a chat prompt's limit. */
export const STEP_PROMPT_MAX = CHAT_PROMPT.max;
/** The longest reply of the step before that a prompt quotes. */
export const PROMPT_REPLY_MAX = 4_000;
/** The artifacts a prompt lists before "and N more". */
export const PROMPT_ARTIFACTS_MAX = 25;
/** What ends a text cut to fit. */
export const PROMPT_CUT = '[… cut to fit; the whole text is on the task]';

const KIND_WORDS: Readonly<Record<FlowStepKind, string>> = {
  work: 'Work',
  check: 'Check',
  signoff: 'Sign-off',
};

/** A text cut to `max` characters, ending in `PROMPT_CUT` when it was longer. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - PROMPT_CUT.length - 1)).trimEnd()}\n${PROMPT_CUT}`;
}

const quoted = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');

/** A size in words: `340 B`, `1.2 KB`, `2.0 MB`. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the step's kind asks for, and how to answer. */
function stepAsk(input: StepPromptInput): string {
  const back = input.sendsBackTo
    ? ` A send-back returns the task to "${input.sendsBackTo}" for another round.`
    : '';
  if (input.step.kind === 'work') {
    const to = input.next ? `"${input.next}"` : 'the person who closes it';
    return (
      `Do the work the task asks for. End your turn with a short hand-off for ${to}: what you did, where it is ` +
      '(branch, commit, files) and what to check.'
    );
  }
  if (input.step.kind === 'check') {
    return (
      'Check the work handed to you against the task; do not fix it yourself. End your turn with your verdict alone ' +
      'on its first line, PASS or SEND BACK, then your findings: what is wrong, where, and what to change.' +
      back
    );
  }
  return `Decide whether the task is done. End your turn with APPROVE or SEND BACK alone on its first line, then why.${back}`;
}

/** How the task came, in one sentence. */
function arrivalLine(input: StepPromptInput): string {
  const { kind, from } = input.handoff.arrival;
  const named = from ? `"${from}"` : 'The step before';
  switch (kind) {
    case 'handed_on':
      return `${named} handed it on to you.`;
    case 'passed':
      return `${named} passed it.`;
    case 'signed_off':
      return `${named} approved it.`;
    case 'sent_back':
      return `${from ? `"${from}"` : 'A later step'} sent it back to you for round ${input.round}.`;
    case 'routed':
      return `The team's Lead put it at this step${from ? ` from "${from}"` : ''}.`;
    case 'retried':
      return "It came back after an escalation to the team's Lead.";
    default:
      return 'The task is new here: no step handed anything on yet.';
  }
}

/** One artifact's line: `1-develop/round-1/notes.md (file, 340 B)`. */
const artifactLine = (a: PromptArtifact) =>
  `- ${a.step}/round-${a.round}/${a.name} (${a.kind}, ${sizeWords(a.size)})`;

/** The artifacts as a list, the latest `PROMPT_ARTIFACTS_MAX`, or undefined for none. */
function artifactList(title: string, artifacts: readonly PromptArtifact[]): string | undefined {
  if (artifacts.length === 0) return undefined;
  const shown = artifacts.slice(-PROMPT_ARTIFACTS_MAX).map(artifactLine);
  const more = artifacts.length - shown.length;
  return [title, ...(more > 0 ? [`- … and ${more} earlier`] : []), ...shown].join('\n');
}

/** The hand-off: how it came, the reason, the last reply, the artifacts. */
function handoffText(input: StepPromptInput, artifactsTitle: string): string {
  const { arrival, reply } = input.handoff;
  const parts = [arrivalLine(input)];
  if (arrival.reason) {
    const why = arrival.kind === 'sent_back' ? 'Their reason and findings:' : 'Why:';
    parts.push(`${why}\n${quoted(arrival.reason)}`);
  }
  if (reply && arrival.from)
    parts.push(`The last reply of "${arrival.from}":\n${quoted(clipText(reply, PROMPT_REPLY_MAX))}`);
  const list = artifactList(artifactsTitle, input.handoff.artifacts);
  if (list) parts.push(list);
  return parts.join('\n\n');
}

/** Where outputs go, and what happens to them. */
const outputsText = (input: StepPromptInput) =>
  `Write the files you make for this step (notes, logs, screenshots) to \`${input.folder}/\` in your home folder. ` +
  `When your turn ends they are collected and kept with the task: text and images, up to ${sizeWords(ARTIFACT_LIMITS.fileBytes)} ` +
  `each and ${ARTIFACT_LIMITS.files} files. Your final reply is kept as the step's hand-off note.`;

const NOBODY_MOVES =
  'Nobody moves the task for you yet: when your turn ends, a person reads your reply and moves the task on.';

/** The full prompt: a new conversation (the step's first, or Fresh). */
function fullPrompt(input: StepPromptInput): string {
  const { task, step } = input;
  const at = `step ${step.position}, "${step.name}" (${KIND_WORDS[step.kind]}), round ${input.round}`;
  const head = `# ${task.key} · ${task.title}\n\nYou are working on task ${task.key} at ${at} of its flow.`;
  const after = [
    `## The flow\n\n${input.flowText.trimEnd()}\n\nYou are at "${step.name}".`,
    `## Your step\n\n${stepAsk(input)}\n\n${NOBODY_MOVES}`,
    `## The hand-off\n\n${handoffText(input, 'The task’s artifacts so far (kept with the task):')}`,
    `## Your outputs\n\n${outputsText(input)}`,
  ].join('\n\n');
  const description = task.description.trim() === '' ? '(no description)' : task.description.trim();
  const room = STEP_PROMPT_MAX - head.length - after.length - '\n\n## The task\n\n\n\n'.length;
  const text = `${head}\n\n## The task\n\n${clipText(description, Math.max(room, 200))}\n\n${after}`;
  return clipText(text, STEP_PROMPT_MAX);
}

/** The delta: a continued conversation (Keep) gets only what is new since its last round. */
function deltaPrompt(input: StepPromptInput): string {
  const { task, step } = input;
  const named = `"${step.name}" (${KIND_WORDS[step.kind]})`;
  if (input.round === 1) {
    const head = `Continue task ${task.key} at your step ${named}, round 1, where you left off.`;
    return clipText(`${head}\n\n${outputsText(input)}\n\n${stepAsk(input)}`, STEP_PROMPT_MAX);
  }
  const head = `Task ${task.key} is back at your step ${named}: round ${input.round}.`;
  const text = [
    head,
    `## The hand-off\n\n${handoffText(input, 'New artifacts since your last round:')}`,
    `## Your outputs\n\n${outputsText(input)}\n\n${stepAsk(input)}`,
  ].join('\n\n');
  return clipText(text, STEP_PROMPT_MAX);
}

/** A step's prompt: `full` for a new conversation, `delta` for one that continues (see above). */
export function stepPrompt(input: StepPromptInput, mode: 'full' | 'delta'): string {
  return mode === 'full' ? fullPrompt(input) : deltaPrompt(input);
}
