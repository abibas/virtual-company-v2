import { z } from 'zod';
import { CHAT_PROMPT } from '../chats.ts';
import { protocolObject, Uuid } from '../runner-protocol/common.ts';
import { AnsweredEvent, QuestionEvent } from './questions.ts';
import { HarnessMessageId, HarnessSessionId } from './specs.ts';

/**
 * What a turn's output means, the same for every harness (docs/harness.md, "Events"): the conversation's id and what
 * it runs on, the assistant's text and thinking, a tool call and its result (summaries only), the to-do list, the
 * subagents it started, the tokens used and how full the context is, a compaction, a notice for the person, a message
 * the person sent into the running turn (S5.2 step 6), and the turn's end. A runner sends them in order as `turn.events`, numbered from 1 (docs/runner-protocol.md, "Chat turns").
 * Two more come from elsewhere (`questions.ts`): a question the agent asked through the runner's tool, and the
 * person's answer to it, which the server adds. Every string and list has a limit; events stored before a field or
 * type was added stay valid.
 */

/** The longest one-line summary of a tool call's input. */
export const TOOL_SUMMARY_MAX = 200;
/** The longest summary of a tool call's result. */
export const TOOL_RESULT_SUMMARY_MAX = 500;
/** The longest notice. */
export const NOTICE_MAX = 2000;
/** The longest error of a failed turn. */
export const RESULT_ERROR_MAX = 2000;
/** The longest thinking text; a longer one is cut, ending in `TRUNCATED_MARKER`. */
export const THINKING_MAX = 20_000;
/** The longest answer of a subagent; a longer one is cut, ending in `TRUNCATED_MARKER`. */
export const SUBAGENT_SUMMARY_MAX = 4000;
/** The longest step a subagent reports (`Running Read file…`), and its description. */
export const SUBAGENT_STEP_MAX = 200;
export const SUBAGENT_DESCRIPTION_MAX = 200;
/** The longest subagent type (`Explore`, `general-purpose`, a custom agent's name). */
export const SUBAGENT_TYPE_MAX = 100;
/** The most items of a to-do list, and the longest item. */
export const TODO_ITEMS_MAX = 100;
export const TODO_TEXT_MAX = 300;
/** The most slash commands an `init` lists, and the longest one. */
export const SLASH_COMMANDS_MAX = 200;
export const SLASH_COMMAND_MAX = 100;
/** The longest model id an event names (`claude-opus-5-5[1m]`). */
export const EVENT_MODEL_MAX = 200;
/** The longest working folder and reasoning effort an `init` names. */
export const EVENT_CWD_MAX = 4096;
export const EVENT_EFFORT_MAX = 50;

/** What a text cut to its limit ends with, so the reader knows there was more. */
export const TRUNCATED_MARKER = '\n… [truncated]';

const Count = z.int().nonnegative();
const ToolId = z.string().min(1).max(200);
const Model = z.string().min(1).max(EVENT_MODEL_MAX);

/** The subagent an event belongs to: the id of the Agent/Task call that started it; absent for the main agent's. */
const belongs = { parentId: ToolId.optional() };

export const NoticeLevel = z.enum(['info', 'warn']);
export type NoticeLevel = z.infer<typeof NoticeLevel>;

export const TodoStatus = z.enum(['pending', 'in_progress', 'completed']);
export type TodoStatus = z.infer<typeof TodoStatus>;

/** One item of the to-do list. */
export const TodoItem = protocolObject({ text: z.string().min(1).max(TODO_TEXT_MAX), status: TodoStatus });
export type TodoItem = z.infer<typeof TodoItem>;

/** A subagent working (`running`), finished with its answer (`done`), failed, or ended with the turn (`interrupted`). */
export const SubagentStatus = z.enum(['running', 'done', 'failed', 'interrupted']);
export type SubagentStatus = z.infer<typeof SubagentStatus>;

/** Who started a compaction: the person's `/compact`, or the harness itself near the end of the window. */
export const CompactTrigger = z.enum(['manual', 'auto']);
export type CompactTrigger = z.infer<typeof CompactTrigger>;

/** What the turn runs on, as the harness said at its start (Claude Code's `system/init`). */
export const InitEvent = protocolObject({
  type: z.literal('init'),
  /** The model the harness runs; null when it did not say. */
  model: Model.nullable(),
  effort: z.string().min(1).max(EVENT_EFFORT_MAX).optional(),
  cwd: z.string().min(1).max(EVENT_CWD_MAX).optional(),
  /** The slash commands and skills the harness offers (`compact`, `review`), without the slash. */
  slashCommands: z.array(z.string().min(1).max(SLASH_COMMAND_MAX)).max(SLASH_COMMANDS_MAX).optional(),
});
export type InitEvent = z.infer<typeof InitEvent>;

export const TurnEvent = z.discriminatedUnion('type', [
  protocolObject({ type: z.literal('session'), sessionId: HarnessSessionId }),
  InitEvent,
  protocolObject({ type: z.literal('text'), text: z.string().min(1), ...belongs }),
  protocolObject({ type: z.literal('thinking'), text: z.string().min(1).max(THINKING_MAX), ...belongs }),
  protocolObject({
    type: z.literal('tool'),
    id: ToolId,
    name: z.string().min(1).max(200),
    summary: z.string().max(TOOL_SUMMARY_MAX),
    ...belongs,
  }),
  protocolObject({
    type: z.literal('tool_result'),
    id: ToolId,
    ok: z.boolean(),
    summary: z.string().max(TOOL_RESULT_SUMMARY_MAX),
    ...belongs,
  }),
  protocolObject({
    type: z.literal('todo'),
    /** The whole list as it is now: each event replaces the one before. */
    items: z.array(TodoItem).max(TODO_ITEMS_MAX),
    ...belongs,
  }),
  protocolObject({
    type: z.literal('subagent'),
    /** The id of the Agent/Task call that started it; each event is its whole state now, the latest one counts. */
    id: ToolId,
    agentType: z.string().min(1).max(SUBAGENT_TYPE_MAX),
    description: z.string().max(SUBAGENT_DESCRIPTION_MAX),
    /** The model asked for; absent: the main agent's. */
    model: Model.optional(),
    background: z.boolean().optional(),
    status: SubagentStatus,
    /** Its answer, once it ended. */
    summary: z.string().max(SUBAGENT_SUMMARY_MAX).optional(),
    lastStep: z.string().max(SUBAGENT_STEP_MAX).optional(),
    ...belongs,
  }),
  protocolObject({
    type: z.literal('usage'),
    /** Every input token, cached ones included. */
    inputTokens: Count,
    outputTokens: Count,
    /** The input tokens read from the prompt cache. */
    cachedInputTokens: Count.optional(),
    costUsd: z.number().nonnegative().optional(),
  }),
  protocolObject({
    type: z.literal('context'),
    /** The last request to the model: its size is `inputTokens + cacheReadTokens + cacheCreationTokens`. */
    inputTokens: Count,
    cacheReadTokens: Count,
    cacheCreationTokens: Count,
    outputTokens: Count,
    /** The model's context window; null when it is not known. */
    window: z.int().positive().nullable(),
    /**
     * True when the harness gives no last request's usage and this is the turn's total instead (Codex): a turn with
     * several model calls reads higher than the conversation is.
     */
    estimate: z.literal(true).optional(),
  }),
  protocolObject({
    type: z.literal('compact'),
    /** The conversation's size before and after; `postTokens` null when the harness did not say. */
    preTokens: Count,
    postTokens: Count.nullable(),
    trigger: CompactTrigger.optional(),
  }),
  protocolObject({
    type: z.literal('notice'),
    level: NoticeLevel,
    message: z.string().min(1).max(NOTICE_MAX),
    ...belongs,
  }),
  protocolObject({
    type: z.literal('input'),
    /** The person's message the harness took mid-turn (Claude Code's echo of it), as the runner wrote it. */
    text: z.string().min(CHAT_PROMPT.min).max(CHAT_PROMPT.max),
    /** The id it was sent with (`turn.input`'s): the queued turn the server keeps until the harness takes it. */
    inputId: Uuid.optional(),
  }),
  protocolObject({
    type: z.literal('result'),
    ok: z.boolean(),
    /** The reply: the turn's last assistant message. */
    text: z.string().optional(),
    error: z.string().min(1).max(RESULT_ERROR_MAX).optional(),
    durationMs: Count.optional(),
    /** Claude Code: the main agent's last message's uuid, where a branch from this turn's reply resumes up to. */
    messageId: HarnessMessageId.optional(),
  }),
  QuestionEvent,
  AnsweredEvent,
]);
export type TurnEvent = z.infer<typeof TurnEvent>;
export type TurnEventType = TurnEvent['type'];
export type TurnEventOf<T extends TurnEventType> = Extract<TurnEvent, { type: T }>;

/** Every event type, in the order a turn usually shows them. */
export const TURN_EVENT_TYPES = [
  'session',
  'init',
  'text',
  'thinking',
  'tool',
  'tool_result',
  'todo',
  'subagent',
  'usage',
  'context',
  'compact',
  'notice',
  'input',
  'result',
  'question',
  'answered',
] as const satisfies readonly TurnEventType[];
