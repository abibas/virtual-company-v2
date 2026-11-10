import { CODEX_CHILD_THREAD_IDS, CODEX_THREAD_ID } from '../../src/fixtures.ts';
import { turnContext } from './rollout.ts';

/**
 * Recorded-style lines of a Codex subagent's own session file, shaped as Codex writes them (`session_meta` with its
 * `source.subagent.thread_spawn`, `turn_context`, an `item_completed` per command), with made-up text.
 */

export const [CHILD_A, CHILD_B, CHILD_C] = CODEX_CHILD_THREAD_IDS;

let ordinal = 0;
const line = (type: string, payload: object) =>
  JSON.stringify({ timestamp: '2026-11-10T09:12:00.000Z', ordinal: ordinal++, type, payload });

/** Its first line: the thread it is, who spawned it, and its role when it has one. */
export const childMeta = (id: string, role?: string) =>
  line('session_meta', {
    id,
    parent_thread_id: CODEX_THREAD_ID,
    cli_version: '0.167.0',
    source: {
      subagent: {
        thread_spawn: { parent_thread_id: CODEX_THREAD_ID, depth: 1, ...(role ? { agent_role: role } : {}) },
      },
    },
    thread_source: 'subagent',
    ...(role ? { agent_role: role } : {}),
  });

/** A command it ran, as Codex 0.16x records it; `exec_command_end` as older ones did. */
export const commandDone = (command: readonly string[]) =>
  line('event_msg', {
    type: 'item_completed',
    thread_id: 't',
    item: { type: 'CommandExecution', id: 'c', command, status: 'completed', exit_code: 0 },
  });
export const execEnd = (command: readonly string[]) =>
  line('event_msg', { type: 'exec_command_end', command });

/** A subagent's whole file: it ran `python3 wait.py` on `model`. */
export const childLines = (id: string, model: string, role?: string) => [
  childMeta(id, role),
  turnContext(model, 'low'),
  commandDone(['/bin/zsh', '-lc', 'python3 wait.py']),
  line('event_msg', { type: 'task_complete', turn_id: 't' }),
];

/** Where its file is in `home`. */
export const childPath = (home: string, id: string) =>
  `${home}/sessions/2026/11/10/rollout-2026-11-10T09-12-00-${id}.jsonl`;
