import { CODEX_CHILD_THREAD_IDS, CODEX_THREAD_ID } from '../../src/fixtures.ts';

/**
 * Recorded-style lines of the session files a multi-agent v2 turn writes, shaped as Codex 0.167.0 serializes them
 * (`RolloutLine` `{ timestamp, ordinal, type, payload }`; `EventMsg` tagged `type` in snake_case; `TurnItem` tagged
 * `type` in PascalCase; `SubAgentActivityItem` / `SubAgentActivityEvent` with `model` and `reasoning_effort` written as
 * null when unknown; `AgentPath` as its string), with made-up text: the agent spawns `sleep_sol`, `sleep_terra` and
 * `sleep_luna`, each runs a Python sleep, and the parent waits.
 */

export const [SOL, TERRA, LUNA] = CODEX_CHILD_THREAD_IDS;
export const PARENT = CODEX_THREAD_ID;

/** When the runner started the turn (ms), and a second of it as Codex writes `started_at`. */
export const SINCE = Date.UTC(2026, 10, 10, 9, 12, 0, 400);
export const NOW_S = Math.floor(SINCE / 1000);

let ordinal = 0;
export const line = (type: string, payload: object) =>
  JSON.stringify({ timestamp: '2026-11-10T09:12:01.000Z', ordinal: ordinal++, type, payload });
const event = (payload: object) => line('event_msg', payload);

/** A turn's start: a root thread's (the agent's own, `root_turn_id` = `turn_id`) or, with `root: false`, a subagent's. */
export const taskStarted = (startedAt: number | null = NOW_S + 1, root = true) =>
  event({
    type: 'task_started',
    turn_id: root ? 't' : 'child-turn',
    root_turn_id: 't',
    ...(startedAt === null ? {} : { started_at: startedAt }),
    model_context_window: 475_000,
    collaboration_mode_kind: 'default',
  });

export const meta = (id: string, mode: 'paginated' | 'legacy' = 'paginated', parent?: string) =>
  line('session_meta', {
    id,
    cli_version: '0.167.0',
    history_mode: mode,
    source: parent
      ? { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: '/root/sleep_sol' } } }
      : 'exec',
    ...(parent ? { parent_thread_id: parent, multi_agent_version: 'v2' } : {}),
  });

/** The agent's `spawn_agent` call (namespace `collaboration`), its arguments a JSON string. */
export const spawnCall = (callId: string, args: object, name = 'spawn_agent') =>
  line('response_item', {
    type: 'function_call',
    name,
    namespace: 'collaboration',
    arguments: JSON.stringify(args),
    call_id: callId,
  });

type Kind = 'started' | 'interacted' | 'interrupted' | 'completed';
const activityFields = (
  thread: string,
  path: string,
  kind: Kind,
  model: string | null,
  effort: string | null,
) => ({
  model,
  reasoning_effort: effort,
  agent_thread_id: thread,
  agent_path: path,
  kind,
});

/** An activity as a paginated thread writes it (every kind), and a legacy one its `completed`. */
export const activityItem = (
  id: string,
  thread: string,
  path: string,
  kind: Kind,
  model: string | null = null,
  effort: string | null = null,
) =>
  event({
    type: 'item_completed',
    thread_id: PARENT,
    turn_id: 't',
    item: { type: 'SubAgentActivity', id, ...activityFields(thread, path, kind, model, effort) },
    started_at_ms: SINCE + 2000,
    completed_at_ms: SINCE + 2000,
  });

/** An activity as a legacy thread writes it (every kind but `completed`). */
export const activityEvent = (
  id: string,
  thread: string,
  path: string,
  kind: Kind,
  model: string | null = null,
  effort: string | null = null,
) =>
  event({
    type: 'sub_agent_activity',
    event_id: id,
    occurred_at_ms: SINCE + 2000,
    ...activityFields(thread, path, kind, model, effort),
  });

/** A command's call: `exec_command` with its `cmd`. */
export const execCall = (callId: string, cmd: string) =>
  line('response_item', {
    type: 'function_call',
    name: 'exec_command',
    arguments: JSON.stringify({ cmd, yield_time_ms: 10_000 }),
    call_id: callId,
  });

/** A command that ended, as a paginated thread records it. */
export const commandItem = (callId: string, argv: readonly string[], exitCode = 0, output = '') =>
  event({
    type: 'item_completed',
    thread_id: 'c',
    turn_id: 't',
    item: {
      type: 'CommandExecution',
      id: callId,
      command: argv,
      cwd: 'file:///home/agent',
      parsed_cmd: [],
      source: 'agent',
      status: exitCode === 0 ? 'completed' : 'failed',
      aggregated_output: output,
      exit_code: exitCode,
      duration: '45.0s',
    },
    started_at_ms: SINCE + 3000,
    completed_at_ms: SINCE + 48_000,
  });

/** The output a legacy thread records for a call. */
export const callOutput = (callId: string, output: unknown) =>
  line('response_item', { type: 'function_call_output', call_id: callId, output });

/** A message, paginated (an item) or legacy (an event). */
export const messageItem = (text: string) =>
  event({
    type: 'item_completed',
    thread_id: 'c',
    turn_id: 't',
    item: { type: 'AgentMessage', id: 'm', content: [{ type: 'Text', text }], phase: 'final_answer' },
    completed_at_ms: SINCE + 48_500,
  });
export const messageEvent = (text: string) => event({ type: 'agent_message', message: text });

export const taskComplete = (answer: string | null, error?: string) =>
  event({
    type: 'task_complete',
    turn_id: 't',
    last_agent_message: answer,
    ...(error ? { error: { message: error } } : {}),
    started_at: NOW_S + 1,
    completed_at: NOW_S + 49,
  });

const SLEEP = (seconds: number) => ['/bin/bash', '-lc', `python3 -c 'import time; time.sleep(${seconds})'`];

/** A subagent's own turn's start. */
export const ownTurn = (startedAt = NOW_S + 1) => taskStarted(startedAt, false);

/**
 * `sleep_sol`'s whole file: forked with the parent's history (an earlier turn, and the running one up to the spawn, its
 * calls kept as `preserve_fork_prefix` keeps them), then its own turn running one sleep.
 */
export const solLines = () => [
  meta(SOL, 'paginated', PARENT),
  taskStarted(NOW_S - 600),
  execCall('call_old', 'ls'),
  commandItem('call_old', ['ls']),
  taskStarted(),
  execCall('call_parent', 'git status'),
  messageEvent('I will spawn three agents.'),
  ownTurn(),
  line('turn_context', { turn_id: 't', model: 'gpt-6.1-sol', effort: 'high' }),
  execCall('call_sol', `python3 -c 'import time; time.sleep(45)'`),
  commandItem('call_sol', SLEEP(45)),
  messageItem('Slept 45 seconds.'),
  taskComplete('Slept 45 seconds.'),
];

/** Where a file is in `home`. */
export const pathOf = (home: string, id: string, day = '2026/11/10') =>
  `${home}/sessions/${day}/rollout-2026-11-10T09-12-0${id === PARENT ? '0' : '2'}-${id}.jsonl`;
