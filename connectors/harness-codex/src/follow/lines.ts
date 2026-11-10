import { isRecord, type JsonRecord, parseJsonLine, stringOf } from '@mwc/harness-core';

/**
 * Reading a session file's lines (`{ timestamp, ordinal?, type, payload }`, Codex's `RolloutLine`): only a line naming
 * one of the markers is parsed, so a long output or message is never `JSON.parse`d for nothing; and the turn gate.
 * A file can start with history that is not this turn's: a resumed thread's earlier turns, or the parent's turns a
 * subagent was forked with (Codex's default `fork_turns: "all"` copies them into the child's file, the running one too:
 * its `task_started`, its messages and, with `preserve_fork_prefix`, its calls). Every turn opens with an `event_msg`
 * `task_started` whose `started_at` is in Unix seconds and whose `root_turn_id` equals its `turn_id` in the root thread
 * (the agent's own) and not in a subagent's, so lines count only after one that started no earlier than the turn the
 * runner started (`since`, in milliseconds), and in a subagent's file only after one of its own (not a root turn).
 */

/** The line as JSON when it names one of `markers`; null otherwise or when it is not a JSON object. */
export function pick(text: string, markers: readonly string[]): JsonRecord | null {
  return markers.some((marker) => text.includes(marker)) ? parseJsonLine(text) : null;
}

/** A line's payload; empty when it has none. */
export const payloadOf = (line: JsonRecord): JsonRecord => (isRecord(line.payload) ? line.payload : {});

/** The marker of a turn's start. */
export const TURN_STARTED = '"task_started"';

/** A turn's start: when it began (Unix seconds, null when it does not say), and whether it is a root thread's turn. */
export interface TurnStart {
  readonly startedAt: number | null;
  readonly root: boolean;
}

/** What a `task_started` line says of its turn; undefined for any other line. */
export function turnStartOf(line: JsonRecord): TurnStart | undefined {
  const payload = payloadOf(line);
  if (line.type !== 'event_msg' || payload.type !== 'task_started') return undefined;
  const at = payload.started_at;
  const root = typeof payload.root_turn_id === 'string' && payload.root_turn_id === payload.turn_id;
  return { startedAt: typeof at === 'number' && Number.isFinite(at) ? at : null, root };
}

/** Whether a turn that began at `startedAt` (seconds; null: unknown) is this one or later, the runner's start `since`. */
export const isOwnTurn = (startedAt: number | null, since: number): boolean =>
  startedAt === null || startedAt >= Math.floor(since / 1000);

/** A `function_call`'s name without its namespace, and its JSON arguments (empty when they are not JSON). */
export function callOf(payload: JsonRecord): { readonly name: string; readonly args: JsonRecord } {
  const name = (stringOf(payload.name) ?? '').split(/[./]|__/).at(-1) as string;
  const text = stringOf(payload.arguments);
  const parsed = text === undefined ? null : parseJsonLine(text);
  return { name, args: parsed ?? {} };
}
