import { z } from 'zod';
import { CHAT_PROMPT } from '../chats.ts';
import { Harness } from '../enums.ts';
import { TOOL_RESULT_MAX } from '../flows/tools.ts';
import { AskQuestions, CodexAuthJson, ServerToolName, TurnEvent, TurnSpec } from '../harness.ts';
import { TurnArtifact, TurnArtifacts } from './artifacts.ts';
import { ErrorText, frame, JsonObject, protocolObject, Uuid } from './common.ts';
import { EVENT_BATCH_MAX_EVENTS } from './constants.ts';
import { TurnAck, TurnResume } from './reattach.ts';

/**
 * Chat turns (S5.1b, docs/harness.md "How a turn runs"): the server asks a runner for one turn of a harness
 * (`turn.start`, with the credential it resolved), may send the person's message into it while it runs (`turn.input`,
 * S5.2 step 6) and may stop it (`turn.stop`); the runner sends the turn's events as
 * they come (`turn.events`, batched), a question the agent asked through the runner's tool (`turn.question`, S5.2), a
 * task step's collected files (`turn.artifact`, `turn.artifacts`, S5.3b), a call of an agents' tool (`turn.tool`,
 * answered by `turn.tool.result`, S6a) and how it ended (`turn.end`, once). Since
 * S5.4 a turn outlives its link: the runner keeps its process and its events, says hello with it after a reconnect or
 * its own restart, and the server answers where to resume (`turn.resume`) and acknowledges its end (`turn.ack`;
 * `reattach.ts`). And what a runner says of its harnesses in its hello: each CLI's version, or null when it is not
 * installed.
 */

/** The version a harness's CLI printed (`2.1.319 (Claude Code)`, `codex-cli 0.163.0`). */
export const HarnessVersion = z.string().min(1).max(100);

/**
 * The harnesses a runner can run (`runner.hello.caps.harnesses`): each CLI's version, null when it is not on the
 * runner's PATH. A harness a runner does not know yet is null.
 */
export const HarnessVersions = protocolObject({
  claude_code: HarnessVersion.nullable().default(null),
  codex: HarnessVersion.nullable().default(null),
});
export type HarnessVersions = z.infer<typeof HarnessVersions>;

/**
 * `caps.harnesses` as either side reads it: the versions (S5.1b), or the names alone from a runner older than chats,
 * which runs no turn.
 */
export const RunnerHarnesses = z.union([HarnessVersions, z.array(Harness).max(Harness.options.length)]);
export type RunnerHarnesses = z.infer<typeof RunnerHarnesses>;

/**
 * A harness as a runner's hello says it: its CLI's version, null when the CLI is missing there, undefined from a runner
 * older than chats (it named its harnesses only and knows no `turn.start`).
 */
export function harnessVersionOf(harnesses: RunnerHarnesses, harness: Harness): string | null | undefined {
  return Array.isArray(harnesses) ? undefined : harnesses[harness];
}

/** How long a runner gathers a turn's events before it sends them, unless they reach `TURN_EVENTS_BATCH_BYTES` first. */
export const TURN_EVENTS_BATCH_MS = 100;

/** The size at which a runner sends a turn's gathered events at once. */
export const TURN_EVENTS_BATCH_BYTES = 32 * 1024;

/** How long after `turn.stop`'s SIGINT a turn's process group gets SIGTERM, and after SIGINT gets SIGKILL (S5.4). */
export const TURN_STOP_TERM_MS = 10_000;
export const TURN_STOP_KILL_MS = 20_000;

/**
 * Why a runner ended a turn by itself, the code at the start of `turn.end.error` (optionally followed by `: ` and
 * words): no such harness here, every slot taken, the agent's home folder missing, the driver refused the spec, the
 * process could not start, a person stopped it, the runner stopping (a new turn refused), the process ended without
 * its end being recorded (killed while the runner was away, S5.4), the conversation it resumed is not on this machine
 * (`session_missing: <the harness's own line>`, 2026-11-13: the server starts the chat afresh with a recap, once).
 */
export const TURN_ERRORS = [
  'unsupported',
  'busy',
  'home_missing',
  'invalid_spec',
  'spawn_failed',
  'stopped',
  'runner_stopping',
  'process_lost',
  'session_missing',
] as const;
export type TurnError = (typeof TURN_ERRORS)[number];

/**
 * Server to runner: run one chat turn (`spec`, with its credential); `turn.events` and one `turn.end` follow. `afterSeq`
 * (2026-11-13): the turn's events are numbered after it, because the server keeps events of the turn already (its
 * start again on a fresh conversation after `session_missing`, with the server's notice); absent: from 1.
 */
export const TurnStart = frame('turn.start', {
  turnId: Uuid,
  spec: TurnSpec,
  afterSeq: z.int().min(0).optional(),
});
export type TurnStart = z.infer<typeof TurnStart>;

/** Server to runner: stop the turn (SIGINT, SIGTERM 10 s later, SIGKILL 20 s later); its `turn.end` says `stopped`. */
export const TurnStop = frame('turn.stop', {
  turnId: Uuid,
});
export type TurnStop = z.infer<typeof TurnStop>;

/**
 * Server to runner: the person's message for the running turn (S5.2 step 6, docs/harness.md "Delivery while a turn
 * runs"). A turn whose harness takes messages mid-turn (Claude Code's stream-json input) gets it on its stdin, and the
 * harness's echo once it takes it comes back as an `input` event carrying `inputId`; any other turn, a turn that no
 * longer reads its input (its result came and its stdin closed) and a runner older than this frame drop it, and the
 * server starts the message as the next turn instead. No answer.
 */
export const TurnInput = frame('turn.input', {
  turnId: Uuid,
  inputId: Uuid,
  text: z.string().min(CHAT_PROMPT.min).max(CHAT_PROMPT.max),
});
export type TurnInput = z.infer<typeof TurnInput>;

/** One event of a turn, numbered from 1 in the order the runner read it. */
export const TurnEventItem = protocolObject({
  seq: z.int().min(1),
  event: TurnEvent,
});
export type TurnEventItem = z.infer<typeof TurnEventItem>;

/** Runner to server: the turn's next events (batched about 100 ms or 32 KB, in order). */
export const TurnEvents = frame('turn.events', {
  turnId: Uuid,
  events: z.array(TurnEventItem).min(1).max(EVENT_BATCH_MAX_EVENTS),
});
export type TurnEvents = z.infer<typeof TurnEvents>;

/**
 * Runner to server: the agent asked the person (its `ask_user_question` call, relayed from the runner's MCP server over
 * the turn's private socket; docs/harness.md "Asking the person"). `seq` is the event number the runner gave it among
 * the turn's events (its earlier events were sent before), `questionId` the runner's UUID for the call. The server
 * keeps it as the turn's `question` event; the person's answer comes back as the chat's next prompt.
 */
export const TurnQuestion = frame('turn.question', {
  turnId: Uuid,
  seq: z.int().min(1),
  questionId: Uuid,
  questions: AskQuestions,
});
export type TurnQuestion = z.infer<typeof TurnQuestion>;

/**
 * Runner to server: the agent called one of the turn's agents' tools (S6a, docs/harness.md "Agents' tools"), relayed
 * from the runner's MCP server over the turn's private socket. `callId` is the runner's UUID for the call (a file
 * `task_attach {path}` attaches came just before, as `turn.artifact` parts with this id), `input` the tool's arguments
 * as the runner checked them (the server checks them again, with who may do what). Answered by `turn.tool.result`.
 * Since S7.1c it may name one of the server's own tools (`TurnSpec.serverTools`), whose name may be camelCase.
 */
export const TurnTool = frame('turn.tool', {
  turnId: Uuid,
  callId: Uuid,
  tool: ServerToolName,
  input: JsonObject,
});
export type TurnTool = z.infer<typeof TurnTool>;

/**
 * Server to runner: the answer to a `turn.tool`, which the tool returns to the agent: `ok` with what happened (a move
 * recorded as the turn's decision, an artifact kept, the board), or not with why (a tool error the agent reads).
 */
export const TurnToolResult = frame('turn.tool.result', {
  turnId: Uuid,
  callId: Uuid,
  ok: z.boolean(),
  text: z.string().min(1).max(TOOL_RESULT_MAX),
});
export type TurnToolResult = z.infer<typeof TurnToolResult>;

/**
 * Runner to server: the turn ended, after its last events. `ok` is its result's; `exitCode` the process's (null when a
 * signal ended it or it never started); `error` why the runner ended or refused it (a `TURN_ERRORS` code); `authJson`
 * the Codex login the process rewrote while it ran (its token refreshed), for the server to seal again.
 */
export const TurnEnd = frame('turn.end', {
  turnId: Uuid,
  ok: z.boolean(),
  exitCode: z.int().nullable(),
  error: ErrorText.optional(),
  authJson: CodexAuthJson.optional(),
});
export type TurnEnd = z.infer<typeof TurnEnd>;

/** The turn frames the server sends. */
export const TURN_SERVER_FRAMES = [
  TurnStart,
  TurnInput,
  TurnStop,
  TurnResume,
  TurnAck,
  TurnToolResult,
] as const;
export type TurnServerFrame = TurnStart | TurnInput | TurnStop | TurnResume | TurnAck | TurnToolResult;

/** The turn frames a runner sends (a task step's artifacts, S5.3b, are `artifacts.ts`'s). */
export const TURN_RUNNER_FRAMES = [
  TurnEvents,
  TurnQuestion,
  TurnTool,
  TurnArtifact,
  TurnArtifacts,
  TurnEnd,
] as const;
export type TurnRunnerFrame = TurnEvents | TurnQuestion | TurnTool | TurnArtifact | TurnArtifacts | TurnEnd;

/** True for a frame of a chat turn (`turn.*`), of either direction. */
export function isTurnFrame<F extends { readonly type: string }>(
  frame: F,
): frame is Extract<F, TurnServerFrame | TurnRunnerFrame> {
  return frame.type.startsWith('turn.');
}
