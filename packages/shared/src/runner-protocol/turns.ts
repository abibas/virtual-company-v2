import { z } from 'zod';
import { Harness } from '../enums.ts';
import { AskQuestions, CodexAuthJson, TurnEvent, TurnSpec } from '../harness.ts';
import { ErrorText, frame, protocolObject, Uuid } from './common.ts';
import { EVENT_BATCH_MAX_EVENTS } from './constants.ts';

/**
 * Chat turns (S5.1b, docs/harness.md "How a turn runs"): the server asks a runner for one turn of a harness
 * (`turn.start`, with the credential it resolved) and may stop it (`turn.stop`); the runner sends the turn's events as
 * they come (`turn.events`, batched), a question the agent asked through the runner's tool (`turn.question`, S5.2) and
 * how it ended (`turn.end`, once). A turn belongs to the connection that carried its `turn.start`: when the link drops
 * the runner ends its process and the server fails the turn. And what a runner says of its harnesses in its hello: each
 * CLI's version, or null when it is not installed.
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

/** How long after `turn.stop`'s SIGINT a turn's process group gets SIGTERM, and after SIGINT gets SIGKILL. */
export const TURN_STOP_TERM_MS = 5_000;
export const TURN_STOP_KILL_MS = 10_000;

/**
 * Why a runner ended a turn by itself, the code at the start of `turn.end.error` (optionally followed by `: ` and
 * words): no such harness here, every slot taken, the agent's home folder missing, the driver refused the spec, the
 * process could not start, a person stopped it, the runner stopping.
 */
export const TURN_ERRORS = [
  'unsupported',
  'busy',
  'home_missing',
  'invalid_spec',
  'spawn_failed',
  'stopped',
  'runner_stopping',
] as const;
export type TurnError = (typeof TURN_ERRORS)[number];

/** Server to runner: run one chat turn (`spec`, with its credential); `turn.events` and one `turn.end` follow. */
export const TurnStart = frame('turn.start', {
  turnId: Uuid,
  spec: TurnSpec,
});
export type TurnStart = z.infer<typeof TurnStart>;

/** Server to runner: stop the turn (SIGINT, SIGTERM 5 s later, SIGKILL 10 s later); its `turn.end` says `stopped`. */
export const TurnStop = frame('turn.stop', {
  turnId: Uuid,
});
export type TurnStop = z.infer<typeof TurnStop>;

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
export const TURN_SERVER_FRAMES = [TurnStart, TurnStop] as const;
export type TurnServerFrame = TurnStart | TurnStop;

/** The turn frames a runner sends. */
export const TURN_RUNNER_FRAMES = [TurnEvents, TurnQuestion, TurnEnd] as const;
export type TurnRunnerFrame = TurnEvents | TurnQuestion | TurnEnd;

/** True for a frame of a chat turn (`turn.*`), of either direction. */
export function isTurnFrame<F extends { readonly type: string }>(
  frame: F,
): frame is Extract<F, TurnServerFrame | TurnRunnerFrame> {
  return frame.type.startsWith('turn.');
}
