import { clipLine, isRecord, type JsonRecord, parseJsonLine, stringOf } from '@mwc/harness-core';
import { SUBAGENT_STEP_MAX, SUBAGENT_TYPE_MAX } from '@mwc/shared/harness';
import { modelOf } from './reading.ts';
import { findRollout, ROLLOUT_FIRST_READ, type RolloutFs } from './rollout.ts';

/**
 * What a Codex subagent's own session file says of it (docs/harness.md, "Codex subagents"). A subagent is a thread of
 * its own, in the same home folder, with its own file `rollout-<time>-<its thread id>.jsonl`; its commands never reach
 * the parent's `--json` stream. Its `session_meta` names its role (`agent_role`, also written `agent_type`; Codex's
 * `default` is none), each `turn_context` the model it runs, and each command it ran is an `item_completed` of a
 * `CommandExecution` (older Codex: `exec_command_end`) with its argv. One read of the file's end (1 MiB) is enough: a
 * subagent's file is small, and one too long to hold its `session_meta` in that read still gives its model and step.
 */

export interface CodexChild {
  /** The model its last turn ran. */
  readonly model?: string;
  /** The role it was spawned with (`explorer`, `worker`, a custom agent's name); none for Codex's default. */
  readonly role?: string;
  /** Its last command, as a step: `Ran python3 wait.py`. */
  readonly lastStep?: string;
}

/** Only lines naming one of these are parsed. */
const WANTED = ['"session_meta"', '"turn_context"', '"CommandExecution"', '"exec_command_end"'] as const;

const wanted = (line: string): JsonRecord | null =>
  WANTED.some((marker) => line.includes(marker)) ? parseJsonLine(line) : null;

/** A command's argv as the line it ran: the script of `zsh -lc '<script>'`, else the words joined. */
function commandLine(argv: unknown): string | undefined {
  if (typeof argv === 'string') return argv.trim() || undefined;
  if (!Array.isArray(argv)) return undefined;
  const words = argv.filter((word): word is string => typeof word === 'string');
  const flag = words.at(-2);
  const line = flag === '-lc' || flag === '-c' ? words.at(-1) : words.join(' ');
  return line?.trim() || undefined;
}

/** The argv of a command this line says ended, if it is one. */
function commandOf(line: JsonRecord): unknown {
  if (line.type !== 'event_msg' || !isRecord(line.payload)) return undefined;
  const payload = line.payload;
  if (payload.type === 'exec_command_end') return payload.command;
  const item = payload.type === 'item_completed' && isRecord(payload.item) ? payload.item : undefined;
  return item?.type === 'CommandExecution' ? item.command : undefined;
}

/** The role in a `session_meta` payload, or in its `source.subagent.thread_spawn`. */
function roleOf(payload: JsonRecord): string | undefined {
  const source = isRecord(payload.source) && isRecord(payload.source.subagent) ? payload.source.subagent : {};
  const spawn = isRecord(source.thread_spawn) ? source.thread_spawn : {};
  const role = [payload.agent_role, payload.agent_type, spawn.agent_role, spawn.agent_type]
    .map((value) => stringOf(value)?.trim())
    .find((value) => value !== undefined && value !== '');
  return role === undefined || role === 'default' ? undefined : clipLine(role, SUBAGENT_TYPE_MAX - 6);
}

/** What the lines (a file's lines, oldest first) say: the latest model and command, the role. */
export function scanChild(lines: readonly string[]): CodexChild {
  let model: string | undefined;
  let role: string | undefined;
  let step: string | undefined;
  for (const text of lines) {
    const line = wanted(text);
    if (line === null) continue;
    const payload = isRecord(line.payload) ? line.payload : {};
    if (line.type === 'session_meta') role = roleOf(payload) ?? role;
    else if (line.type === 'turn_context') model = modelOf(payload.model) ?? model;
    else step = commandLine(commandOf(line)) ?? step;
  }
  const lastStep = step === undefined ? undefined : clipLine(`Ran ${step}`, SUBAGENT_STEP_MAX);
  return {
    ...(model === undefined ? {} : { model }),
    ...(role === undefined ? {} : { role }),
    ...(lastStep === undefined ? {} : { lastStep }),
  };
}

/** A subagent's reading in `home`; undefined when its file is missing or unreadable. */
export function readChild(fs: RolloutFs, home: string, threadId: string): CodexChild | undefined {
  const path = findRollout(fs, home, threadId);
  if (path === undefined) return undefined;
  const tail = fs.tail(path, ROLLOUT_FIRST_READ);
  if (tail === undefined) return undefined;
  const lines = tail.text.split('\n');
  // A read that starts inside the file starts inside a line.
  if (tail.size > ROLLOUT_FIRST_READ) lines.shift();
  return scanChild(lines);
}
