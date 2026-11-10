import { clipLine, clipMarked, isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import {
  SUBAGENT_DESCRIPTION_MAX,
  SUBAGENT_SUMMARY_MAX,
  type SubagentStatus,
  TOOL_RESULT_SUMMARY_MAX,
  TOOL_SUMMARY_MAX,
  type TurnEvent,
  type TurnEventOf,
} from '@mwc/shared/harness';
import type { CodexChild } from './children.ts';

/**
 * Codex's subagents (docs/harness.md, "Codex subagents"): its `collab_tool_call` items. A `spawn_agent` call names the
 * new threads in `receiver_thread_ids` once it completes, each a subagent (`running`, in the background: it works
 * until the agent `wait`s for it), its description the first line of the call's `prompt`. Every collab call's
 * `agents_states` (`spawn_agent`, `send_input`, `wait`, `close_agent`) moves its subagents: `completed` → `done` with its
 * `message` as the answer, `errored` or `not_found` → `failed`, `interrupted` or `shutdown` → `interrupted`. A subagent
 * that ended is read from its own session file (`children.ts`: its model, its role, its last command). A failed call that
 * names no subagent is a tool line with a failed result; the other calls give no line of their own. One still running
 * when the turn ends is `interrupted`.
 */

type Subagent = Omit<TurnEventOf<'subagent'>, 'type'>;

/** A subagent's own reading, by its thread id; undefined when there is none. */
export type ReadChild = (threadId: string) => CodexChild | undefined;

export interface CollabState {
  /** The subagents by thread id, in the order they started. */
  readonly subagents: Map<string, Subagent>;
  /** Those already read from their session file. */
  readonly read: Set<string>;
}

export function newCollabState(): CollabState {
  return { subagents: new Map(), read: new Set() };
}

/** The type a subagent shows: `Codex agent`, or its role (`Codex explorer`). */
export const CODEX_AGENT_TYPE = 'Codex agent';

const STATUSES: Readonly<Record<string, SubagentStatus>> = {
  pending_init: 'running',
  running: 'running',
  completed: 'done',
  errored: 'failed',
  not_found: 'failed',
  interrupted: 'interrupted',
  shutdown: 'interrupted',
};

const event = (subagent: Subagent): TurnEventOf<'subagent'> => ({ type: 'subagent', ...subagent });

/** The call's thread ids, each a valid event id. */
const receiversOf = (item: JsonRecord): string[] =>
  Array.isArray(item.receiver_thread_ids)
    ? item.receiver_thread_ids.filter(
        (id): id is string => typeof id === 'string' && id !== '' && id.length <= 200,
      )
    : [];

/** The prompt's first line that says something. */
const descriptionOf = (prompt: unknown): string =>
  clipLine(
    stringOf(prompt)
      ?.split('\n')
      .find((line) => line.trim() !== '') ?? '',
    SUBAGENT_DESCRIPTION_MAX,
  );

/** A state's status and its message as the answer. */
function stateOf(value: unknown): { status?: SubagentStatus; summary?: string } {
  if (!isRecord(value)) return {};
  const status = STATUSES[stringOf(value.status) ?? ''];
  const message = stringOf(value.message)?.trim();
  return {
    ...(status === undefined ? {} : { status }),
    ...(message ? { summary: clipMarked(message, SUBAGENT_SUMMARY_MAX) } : {}),
  };
}

/** Its reading from its session file, once: the model, the role as its type, the last command. */
function withReading(state: CollabState, subagent: Subagent, readChild: ReadChild | undefined): Subagent {
  if (readChild === undefined || state.read.has(subagent.id)) return subagent;
  state.read.add(subagent.id);
  let child: CodexChild | undefined;
  try {
    child = readChild(subagent.id);
  } catch {
    child = undefined;
  }
  if (child === undefined) return subagent;
  return {
    ...subagent,
    ...(child.role === undefined ? {} : { agentType: `Codex ${child.role}` }),
    ...(child.model === undefined ? {} : { model: child.model }),
    ...(child.lastStep === undefined ? {} : { lastStep: child.lastStep }),
  };
}

/** Sets a subagent; its event when something changed. */
function put(state: CollabState, after: Subagent): TurnEventOf<'subagent'>[] {
  const before = state.subagents.get(after.id);
  if (before !== undefined && JSON.stringify(before) === JSON.stringify(after)) return [];
  state.subagents.set(after.id, after);
  return [event(after)];
}

/** Moves a running subagent to the status (and answer) a state gives; an ended one stays as it ended. */
function move(state: CollabState, id: string, value: unknown, readChild: ReadChild | undefined) {
  const before = state.subagents.get(id);
  if (before === undefined || before.status !== 'running') return [];
  const { status, summary } = stateOf(value);
  if (status === undefined || status === 'running') return [];
  const ended: Subagent = { ...before, status, ...(summary === undefined ? {} : { summary }) };
  return put(state, withReading(state, ended, readChild));
}

/** A completed `spawn_agent`'s new subagents: as their state says, `running` until then, `failed` if the call failed. */
function spawned(item: JsonRecord, receivers: readonly string[], state: CollabState, readChild?: ReadChild) {
  const states = isRecord(item.agents_states) ? item.agents_states : {};
  const failed = item.status === 'failed';
  return receivers.flatMap((id) => {
    if (state.subagents.has(id)) return [];
    const { status, summary } = stateOf(states[id]);
    const subagent: Subagent = {
      id,
      agentType: CODEX_AGENT_TYPE,
      description: descriptionOf(item.prompt),
      background: true,
      status: failed ? 'failed' : (status ?? 'running'),
      ...(summary === undefined ? {} : { summary }),
    };
    return put(state, subagent.status === 'running' ? subagent : withReading(state, subagent, readChild));
  });
}

/** A failed call that named no subagent, as a tool line: `spawn_agent` with its description, failed. */
function failedCall(item: JsonRecord): TurnEvent[] {
  const id = stringOf(item.id)?.slice(0, 200);
  if (!id) return [];
  const name = stringOf(item.tool) || 'collab';
  const summary = clipLine(descriptionOf(item.prompt), TOOL_SUMMARY_MAX);
  const result = clipLine(`Codex could not ${name.replace(/_/g, ' ')}.`, TOOL_RESULT_SUMMARY_MAX);
  return [
    { type: 'tool', id, name, summary },
    { type: 'tool_result', id, ok: false, summary: result },
  ];
}

/** A `collab_tool_call` item, started, updated or completed: the subagents it starts or moves. */
export function collabEvents(item: JsonRecord, state: CollabState, readChild?: ReadChild): TurnEvent[] {
  if (item.type !== 'collab_tool_call') return [];
  const receivers = receiversOf(item);
  const done = item.status === 'completed' || item.status === 'failed';
  const events: TurnEvent[] =
    item.tool === 'spawn_agent' && done ? spawned(item, receivers, state, readChild) : [];
  const states = isRecord(item.agents_states) ? item.agents_states : {};
  for (const [id, value] of Object.entries(states)) events.push(...move(state, id, value, readChild));
  const named = receivers.some((id) => state.subagents.has(id));
  if (item.status === 'failed' && !(item.tool === 'spawn_agent' && named)) events.push(...failedCall(item));
  return events;
}

/** When the turn ends: each subagent still running is `interrupted`, and each not read yet is read. */
export function endedSubagents(state: CollabState, readChild?: ReadChild): TurnEventOf<'subagent'>[] {
  return [...state.subagents.values()].flatMap((subagent) => {
    const ended: Subagent = subagent.status === 'running' ? { ...subagent, status: 'interrupted' } : subagent;
    return put(state, withReading(state, ended, readChild));
  });
}
