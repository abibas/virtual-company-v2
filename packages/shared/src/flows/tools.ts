import { z } from 'zod';
import { ARTIFACT_LIMITS, ArtifactPath, HANDOFF_NOTE } from './artifacts.ts';
import { type FlowStepKind, type TaskAction, TaskPriority } from './enums.ts';
import { taskNumber } from './keys.ts';
import { STEP_NAME, TASK_DESCRIPTION_MAX, TASK_REASON_MAX, TASK_TITLE } from './limits.ts';

/**
 * The agents' tools (S6a, docs/processes.md "Built in S6a"): the names, the inputs and which turn gets which. A task
 * step's turn gets `task_read`, its kind's moves, `task_attach` and `task_blocked`; a move is recorded as the turn's
 * decision and applied when the turn ends. A flow's Lead gets the board tools in its own chats, which act at once. The
 * runner's MCP server offers them (its `tools/list` from these inputs) and relays each call to the server, which checks
 * the input again and decides; nothing here trusts the runner.
 */

/** A task step's tools. */
export const STEP_TOOLS = [
  'task_read',
  'task_hand_on',
  'task_pass',
  'task_approve',
  'task_send_back',
  'task_attach',
  'task_blocked',
] as const;

/** A flow Lead's tools, in its own chats. */
export const LEAD_TOOLS = [
  'team_board',
  'task_show',
  'task_create',
  'task_route',
  'task_start',
  'task_retry',
  'task_cancel',
] as const;

export const AgentTool = z.enum([...STEP_TOOLS, ...LEAD_TOOLS]);
export type AgentTool = z.infer<typeof AgentTool>;

/** A tool's name on the wire (`TurnSpec.tools`, `turn.tool`): a newer peer's tool parses, and is passed over. */
export const AgentToolName = z.string().regex(/^[a-z][a-z_]{0,63}$/, 'a tool name');

/** The most tools a turn names. */
export const TURN_TOOLS_MAX = 32;

const KIND_MOVES: Readonly<Record<FlowStepKind, readonly AgentTool[]>> = {
  work: ['task_hand_on'],
  check: ['task_pass', 'task_send_back'],
  signoff: ['task_approve', 'task_send_back'],
};

/** The tools a step's turn gets, by the step's kind. */
export const stepTools = (kind: FlowStepKind): AgentTool[] => [
  'task_read',
  ...KIND_MOVES[kind],
  'task_attach',
  'task_blocked',
];

/** The step tools a turn records as its decision, and what each does when the turn ends. */
export const DECISION_ACTIONS = {
  task_hand_on: 'hand_on',
  task_pass: 'pass',
  task_approve: 'approve',
  task_send_back: 'send_back',
  task_blocked: 'blocked',
} as const satisfies Partial<Record<AgentTool, TaskAction | 'blocked'>>;
export type DecisionTool = keyof typeof DECISION_ACTIONS;
export type DecisionAction = (typeof DECISION_ACTIONS)[DecisionTool];

/** The Lead's moves, and the task action each makes at once. */
export const LEAD_ACTIONS = {
  task_route: 'route',
  task_start: 'start',
  task_retry: 'retry',
  task_cancel: 'cancel',
} as const satisfies Partial<Record<AgentTool, TaskAction>>;

/** True for a tool that records the turn's decision. */
export const isDecisionTool = (tool: string): tool is DecisionTool => tool in DECISION_ACTIONS;

/** The longest text a tool takes: a hand-off summary, findings, a note, an attached note's text. */
export const TOOL_TEXT_MAX = 50_000;

/** The longest answer a tool gives. */
export const TOOL_RESULT_MAX = 50_000;

/** The longest link a tool attaches (a link artifact keeps its address as its note). */
export const TOOL_URL_MAX = ARTIFACT_LIMITS.note;

const text = (max: number, description: string) => z.string().trim().min(1).max(max).describe(description);

const TaskKey = z
  .string()
  .trim()
  .refine((key) => taskNumber(key) !== undefined, 'a task key such as T-12')
  .describe('The task’s key, e.g. T-12');

const StepRef = z
  .string()
  .trim()
  .min(1)
  .max(Math.max(STEP_NAME.max, 36))
  .describe('A step of your flow, by its name as the flow writes it');

const Reason = text(TASK_REASON_MAX, 'Why, in a sentence or two');

/** An attachment: a note (`name` and `text`), a file of the outputs folder (`path`) or a link (`name` and `url`). */
export const AttachInput = z
  .object({
    name: text(
      ARTIFACT_LIMITS.name,
      'What to call it on the task; a file keeps its path as its name',
    ).optional(),
    text: text(TOOL_TEXT_MAX, 'A note to keep, Markdown').optional(),
    path: ArtifactPath.describe('A file in your outputs folder, by its path inside that folder').optional(),
    url: z
      .url({ protocol: /^https?$/ })
      .max(TOOL_URL_MAX)
      .describe('A link to keep (http or https)')
      .optional(),
  })
  .superRefine((input, context) => {
    const given = [input.text, input.path, input.url].filter((value) => value !== undefined).length;
    if (given !== 1) context.addIssue({ code: 'custom', message: 'give exactly one of text, path or url' });
    else if (input.path === undefined && input.name === undefined)
      context.addIssue({ code: 'custom', path: ['name'], message: 'a note or a link needs a name' });
    if (input.name !== undefined && input.name.toLowerCase() === HANDOFF_NOTE)
      context.addIssue({ code: 'custom', path: ['name'], message: `"${HANDOFF_NOTE}" is the step's own` });
  });
export type AttachInput = z.infer<typeof AttachInput>;

/** Each tool's input. The server checks it again; the runner checks it before relaying. */
export const AGENT_TOOL_INPUTS = {
  task_read: z.object({}),
  task_hand_on: z.object({
    summary: text(TOOL_TEXT_MAX, 'Your hand-off for the next step: what you did, where it is, what to check'),
  }),
  task_pass: z.object({
    findings: text(TOOL_TEXT_MAX, 'What you checked and found, if anything').optional(),
  }),
  task_approve: z.object({ note: text(TOOL_TEXT_MAX, 'A note on your decision').optional() }),
  task_send_back: z.object({
    reason: Reason,
    findings: text(TOOL_TEXT_MAX, 'What is wrong, where, and what to change'),
  }),
  task_attach: AttachInput,
  task_blocked: z.object({ reason: text(TASK_REASON_MAX, 'What stops you, and what would unblock you') }),
  team_board: z.object({}),
  task_show: z.object({ key: TaskKey }),
  task_create: z.object({
    title: text(TASK_TITLE.max, 'The task’s title'),
    description: text(TASK_DESCRIPTION_MAX, 'What to do, Markdown').optional(),
    priority: TaskPriority.optional().describe('low, normal (the default), high or urgent'),
    step: StepRef.optional().describe('A step to put it into at once; left out, it waits in Queued'),
  }),
  task_route: z.object({ key: TaskKey, step: StepRef }),
  task_start: z.object({ key: TaskKey }),
  task_retry: z.object({ key: TaskKey }),
  task_cancel: z.object({ key: TaskKey, reason: Reason }),
} as const satisfies Record<AgentTool, z.ZodType>;

/** What each tool is for, as its `tools/list` entry says it. */
export const AGENT_TOOL_INFO: Readonly<
  Record<AgentTool, { readonly title: string; readonly description: string }>
> = {
  task_read: {
    title: 'Read the task',
    description:
      'Your task: its key, title and description, its flow, the step it is at and its state, the round, how it came ' +
      'to you (the reason and findings of a send-back, the last hand-off) and its artifacts.',
  },
  task_hand_on: {
    title: 'Hand the task on',
    description:
      'Your work is done: record your hand-off. The task goes to the next step when your turn ends; end it now.',
  },
  task_pass: {
    title: 'Pass the task',
    description:
      'The work passes your check. The task goes to the next step when your turn ends; end it now.',
  },
  task_approve: {
    title: 'Approve the task',
    description: 'Approve it. The task goes to the next step, or is done, when your turn ends; end it now.',
  },
  task_send_back: {
    title: 'Send the task back',
    description:
      'The work needs changes: send it back with why and your findings. It goes back when your turn ends (past ' +
      'the step’s limit, to the team’s Lead instead); end it now.',
  },
  task_attach: {
    title: 'Attach to the task',
    description:
      'Keep something with the task now: a note (name and text), a file from your outputs folder (path) or a link ' +
      '(name and url). Text and images up to 2 MB.',
  },
  task_blocked: {
    title: 'Report blocked',
    description:
      'You cannot go on: say why. The task is marked blocked when your turn ends, for a person to unblock; end it now.',
  },
  team_board: {
    title: 'Team board',
    description:
      'Your flow’s board: Queued, each step, Done and Escalated, with each task’s state and who has it.',
  },
  task_show: {
    title: 'Show a task',
    description: 'One task of your flow: where it is, its description, its history and its artifacts.',
  },
  task_create: {
    title: 'Create a task',
    description:
      'A new task in your flow, queued or put into a step at once (which starts it if the step starts by itself).',
  },
  task_route: {
    title: 'Route a task',
    description: 'Put a task of your flow into a step (a queued, active or escalated one). Acts at once.',
  },
  task_start: {
    title: 'Start a task',
    description: 'Start a task waiting, blocked or ended at its step: its step’s agent runs. Acts at once.',
  },
  task_retry: {
    title: 'Retry a task',
    description: 'Retry an escalated task: it goes where its stopped send-back was going. Acts at once.',
  },
  task_cancel: {
    title: 'Cancel a task',
    description: 'Cancel a task of your flow, saying why. Acts at once.',
  },
};

/** A tool that only reads. */
export const READ_TOOLS: readonly AgentTool[] = ['task_read', 'team_board', 'task_show'];

/**
 * The Lead's section of its chats' standing instructions while its runner offers the tools: brief, naming them. The
 * board is the agent's to read; its steps' agents move their own tasks.
 */
export function leadSection(flowName: string): string {
  return [
    '## Leading your team (from Most Wanted)',
    '',
    `You lead the flow "${flowName.replace(/\s+/g, ' ').trim()}". Your tools act at once, as you: team_board, ` +
      'task_show {key}, task_create {title, description?, priority?, step?}, task_route {key, step}, ' +
      'task_start {key}, task_retry {key} and task_cancel {key, reason}. Each step’s agent moves its own task ' +
      'when its turn ends; you distribute the work, unblock it, and decide on escalations.',
  ].join('\n');
}

/**
 * A step's turn's decision (S6a), kept on the task (`tasks.decision`) from the tool call until the turn ends: the move,
 * its reason (a send-back's, a block's) and its note (the summary, findings or note: the round's hand-off note), what
 * it was found to make when it was recorded, and the turn, conversation, step, round and agent it belongs to.
 */
export interface TaskDecision {
  readonly turnId: string;
  readonly chatId: string;
  readonly stepId: string;
  readonly round: number;
  readonly action: DecisionAction;
  readonly reason: string | null;
  readonly note: string | null;
  /** The step's agent, who recorded it. */
  readonly by: string;
  /** When it was recorded (ISO 8601). */
  readonly at: string;
  /** What it makes when the turn ends, as found when it was recorded. */
  readonly outcome: 'moved' | 'done' | 'escalated' | 'blocked';
  readonly toStepId: string | null;
  readonly toStepName: string | null;
}
