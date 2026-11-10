import { clipLine, type JsonRecord, stringOf } from '@mwc/harness-core';
import { EVENT_EFFORT_MAX, SUBAGENT_DESCRIPTION_MAX } from '@mwc/shared/harness';
import { modelOf } from '../reading.ts';
import { callOf, payloadOf, pick, TURN_STARTED, turnStartOf } from './lines.ts';

/**
 * What the agent's own session file says of its subagents under Codex's multi-agent v2 (docs/harness.md, "Codex
 * subagents"), which `codex exec --json` never prints. A subagent's activity (`SubAgentActivityItem`: `id`, `kind`
 * `started` | `interacted` | `interrupted` | `completed`, `agent_thread_id`, `agent_path` such as `/root/sleep_sol`,
 * `model` and `reasoning_effort` when its spawn resolved them) is written as an `event_msg` `sub_agent_activity` (with
 * `event_id`; a legacy-history thread, every kind but `completed`) or as an `event_msg` `item_completed` whose `item` is
 * `{ type: "SubAgentActivity", … }` (a paginated thread, every kind; a legacy one, `completed`). A spawn's own call is a
 * `response_item` `function_call` named `spawn_agent` (namespace `collaboration`) whose JSON `arguments` hold its
 * `task_name`, `message` (its task), `agent_type`, `model` and `reasoning_effort`; its `call_id` is the `started`
 * activity's `id`.
 */

export type ActivityKind = 'started' | 'interacted' | 'interrupted' | 'completed';

export interface Activity {
  readonly kind: ActivityKind;
  readonly threadId: string;
  /** Its path in the agent tree: `/root/sleep_sol`. */
  readonly path: string;
  /** The spawn call's id for a `started` one. */
  readonly id?: string;
  readonly model?: string;
  readonly effort?: string;
}

export interface SpawnCall {
  readonly callId: string;
  /** The first line of its task that says something. */
  readonly description: string;
  readonly model?: string;
  readonly effort?: string;
}

/** A line that matters here: a turn's start (seconds, null: unknown), an activity, a spawn call. */
export type ParentLine =
  | { readonly turnStarted: number | null }
  | { readonly activity: Activity }
  | { readonly spawn: SpawnCall };

// `spawn_agent"` also matches a name given with its namespace (`collaboration.spawn_agent`).
const MARKERS = [TURN_STARTED, '"sub_agent_activity"', '"SubAgentActivity"', 'spawn_agent"'] as const;
const KINDS: readonly string[] = ['started', 'interacted', 'interrupted', 'completed'];

/** An id a turn event may carry (`ToolId`: 1 to 200 characters). */
export const idOf = (value: unknown): string | undefined => {
  const id = stringOf(value);
  return id && id.length <= 200 ? id : undefined;
};

/** A reasoning effort as an event may name it. */
export const effortOf = (value: unknown): string | undefined => {
  const effort = stringOf(value)?.trim();
  return effort && effort.length <= EVENT_EFFORT_MAX ? effort : undefined;
};

/** The first line of a text that says something, as a description. */
export const firstLine = (text: unknown): string =>
  clipLine(
    stringOf(text)
      ?.split('\n')
      .find((line) => line.trim() !== '') ?? '',
    SUBAGENT_DESCRIPTION_MAX,
  );

/** An activity's fields, wherever it was written. */
function activityOf(fields: JsonRecord, id: unknown): Activity | undefined {
  const kind = stringOf(fields.kind) ?? '';
  const threadId = idOf(fields.agent_thread_id);
  const path = stringOf(fields.agent_path);
  if (!KINDS.includes(kind) || threadId === undefined || path === undefined) return undefined;
  const activityId = idOf(id);
  const model = modelOf(fields.model);
  const effort = effortOf(fields.reasoning_effort);
  return {
    kind: kind as ActivityKind,
    threadId,
    path,
    ...(activityId === undefined ? {} : { id: activityId }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

function spawnOf(payload: JsonRecord): SpawnCall | undefined {
  const callId = idOf(payload.call_id);
  const { name, args } = callOf(payload);
  if (payload.type !== 'function_call' || name !== 'spawn_agent' || callId === undefined) return undefined;
  const model = modelOf(args.model);
  const effort = effortOf(args.reasoning_effort);
  return {
    callId,
    description: firstLine(args.message ?? args.prompt),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** What a line of the agent's own file says; undefined for any other line. */
export function parentLine(text: string): ParentLine | undefined {
  const line = pick(text, MARKERS);
  if (line === null) return undefined;
  const turn = turnStartOf(line);
  if (turn !== undefined) return { turnStarted: turn.startedAt };
  const payload = payloadOf(line);
  if (line.type === 'response_item') {
    const spawn = spawnOf(payload);
    return spawn && { spawn };
  }
  if (line.type !== 'event_msg') return undefined;
  const item = payloadOf({ payload: payload.item });
  const activity =
    payload.type === 'sub_agent_activity'
      ? activityOf(payload, payload.event_id)
      : payload.type === 'item_completed' && item.type === 'SubAgentActivity'
        ? activityOf(item, item.id)
        : undefined;
  return activity && { activity };
}
