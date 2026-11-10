import type { FakeScenario } from '@mwc/harness-core/fake';

/**
 * Recorded-style turns of `codex exec --json` (0.16x), written from its documented thread events
 * (`codex-rs/exec/src/exec_events.rs`), never recorded from a real turn (that would spend a subscription). The
 * connector's tests parse them; the runner's tests play them with the fake binary of `@mwc/harness-core/fake`.
 */

/** The thread every scenario belongs to (the resume continues it). */
export const CODEX_THREAD_ID = '019a6f2e-8b3c-7d41-9e2a-5c8f1b4d7a63';

const started = { type: 'thread.started', thread_id: CODEX_THREAD_ID };
const turnStarted = { type: 'turn.started' };

/** `turn.completed` as Codex 0.167.0 writes it: the turn's sum over its model calls, no window, no last request. */
const usage = (input: number, cached: number, output: number, reasoning: number) => ({
  type: 'turn.completed',
  usage: {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
  },
});

const completed = (item: object) => ({ type: 'item.completed', item });
const message = (id: string, text: string) => completed({ id, type: 'agent_message', text });
const reasoning = (id: string, text: string) => completed({ id, type: 'reasoning', text });

function command(id: string, line: string, status: string, exitCode: number | null, output: string) {
  return {
    id,
    type: 'command_execution',
    command: line,
    aggregated_output: output,
    exit_code: exitCode,
    status,
  };
}

const lines = (...events: readonly object[]) => events.map((event) => JSON.stringify(event));

/** The to-do list Codex keeps as an item: started, updated as it goes, completed with the turn. */
const todoList = (type: string, done: number) => ({
  type,
  item: {
    id: 'item_0',
    type: 'todo_list',
    items: [
      { text: 'Read the parser', completed: done >= 1 },
      { text: 'Add the reasoning event', completed: done >= 2 },
    ],
  },
});

/** The subagents a turn spawns: Codex's own threads, each with its session file. */
export const CODEX_CHILD_THREAD_IDS = [
  '019a6f2f-1a20-7b31-8c4d-2e6f0a9b3c51',
  '019a6f2f-1a24-7e02-9d1a-6b3c8f2e4d72',
  '019a6f2f-1a29-7f43-a5b6-0c7d1e9f8a93',
] as const;

const WAIT_PROMPT =
  'Run python3 wait.py, which sleeps 30 to 60 seconds, then say how long it slept.\nUse no other tool.';

/** A `collab_tool_call` item as Codex writes it (`exec_events.rs`): a spawn names its thread once it completes. */
function collab(id: string, tool: string, status: string, receivers: readonly string[], states: object) {
  const prompt = tool === 'spawn_agent' ? WAIT_PROMPT : null;
  return {
    id,
    type: 'collab_tool_call',
    tool,
    sender_thread_id: CODEX_THREAD_ID,
    receiver_thread_ids: receivers,
    prompt,
    agents_states: states,
    status,
  };
}

const state = (status: string, message: string | null = null) => ({ status, message });

/** Spawning one subagent: the call starts with no thread, and completes naming it, still starting. */
const spawn = (id: string, child: string) => [
  { type: 'item.started', item: collab(id, 'spawn_agent', 'in_progress', [], {}) },
  completed(collab(id, 'spawn_agent', 'completed', [child], { [child]: state('pending_init') })),
];

const [CHILD_A, CHILD_B, CHILD_C] = CODEX_CHILD_THREAD_IDS;

const LS = "/bin/zsh -lc 'ls src'";
const RM = "/bin/zsh -lc 'rm -rf build'";
const TOUCH = "/bin/zsh -lc 'touch /etc/hosts'";
const TEST_A = "/bin/zsh -lc 'pnpm test parser'";
const TEST_B = "/bin/zsh -lc 'pnpm test items'";
const CAT = "/bin/zsh -lc 'cat src/parser.ts'";
const AUTH_ERROR =
  'unexpected status 401 Unauthorized: Your access token could not be refreshed. Please log out and sign in again.';

/**
 * The turns: an answer, a tool call, a refused command, an error, a resume of the first, one that plans with its
 * to-do list, one that spawns three subagents and waits (two finish, the third still runs when the turn ends), and one
 * of several model calls (two commands: three requests whose input `turn.completed` sums).
 */
export const CODEX_SCENARIOS = {
  answer: {
    lines: lines(
      started,
      turnStarted,
      reasoning('item_0', '**Adding two numbers**'),
      message('item_1', '2 + 2 = 4.'),
      usage(12034, 11008, 42, 18),
    ),
    exitCode: 0,
  },
  tool: {
    lines: lines(
      started,
      turnStarted,
      { type: 'item.started', item: command('item_1', LS, 'in_progress', null, '') },
      completed(command('item_1', LS, 'completed', 0, 'index.ts\nmain.ts\n')),
      completed({
        id: 'item_2',
        type: 'file_change',
        changes: [{ path: '/home/agent/work/src/main.ts', kind: 'update' }],
        status: 'completed',
      }),
      message('item_3', 'src holds index.ts and main.ts; I updated main.ts.'),
      usage(25411, 24064, 310, 96),
    ),
    exitCode: 0,
  },
  denied: {
    lines: lines(
      started,
      turnStarted,
      { type: 'item.started', item: command('item_1', RM, 'in_progress', null, '') },
      completed(command('item_1', RM, 'declined', null, '')),
      completed(command('item_2', TOUCH, 'failed', 1, 'touch: /etc/hosts: Operation not permitted\n')),
      message('item_3', 'Both commands were blocked: they need more access than this sandbox gives.'),
      usage(18220, 17152, 120, 40),
    ),
    exitCode: 0,
  },
  error: {
    lines: lines(
      started,
      turnStarted,
      { type: 'error', message: AUTH_ERROR },
      { type: 'turn.failed', error: { message: AUTH_ERROR } },
    ),
    stderr: 'ERROR: unexpected status 401 Unauthorized\n',
    exitCode: 1,
  },
  resume: {
    lines: lines(started, turnStarted, message('item_0', 'Doubled, that is 8.'), usage(12210, 12032, 18, 0)),
    exitCode: 0,
  },
  plan: {
    lines: lines(
      started,
      turnStarted,
      todoList('item.started', 0),
      reasoning('item_1', '**Reading the parser first**'),
      { type: 'item.started', item: command('item_2', CAT, 'in_progress', null, '') },
      completed(command('item_2', CAT, 'completed', 0, 'export class CodexLineParser {\n')),
      todoList('item.updated', 1),
      todoList('item.updated', 1),
      message('item_3', 'The parser reads reasoning items now.'),
      todoList('item.completed', 2),
      usage(30412, 28800, 512, 220),
    ),
    exitCode: 0,
  },
  subagents: {
    lines: lines(
      started,
      turnStarted,
      message('item_0', "I'll spawn three sub-agents."),
      ...spawn('item_1', CHILD_A),
      ...spawn('item_2', CHILD_B),
      ...spawn('item_3', CHILD_C),
      { type: 'item.started', item: collab('item_4', 'wait', 'in_progress', CODEX_CHILD_THREAD_IDS, {}) },
      completed(
        collab('item_4', 'wait', 'completed', CODEX_CHILD_THREAD_IDS, {
          [CHILD_A]: state('completed', 'Slept 41 seconds.'),
          [CHILD_B]: state('completed', 'Slept 33 seconds.'),
          [CHILD_C]: state('running'),
        }),
      ),
      message('item_5', 'Two slept 41 s and 33 s; the third is still sleeping.'),
      usage(36120, 30208, 402, 120),
    ),
    exitCode: 0,
  },
  steps: {
    lines: lines(
      started,
      turnStarted,
      { type: 'item.started', item: command('item_0', TEST_A, 'in_progress', null, '') },
      completed(command('item_0', TEST_A, 'completed', 0, '12 passed\n')),
      { type: 'item.started', item: command('item_1', TEST_B, 'in_progress', null, '') },
      completed(command('item_1', TEST_B, 'completed', 0, '9 passed\n')),
      message('item_2', 'Both tests pass.'),
      usage(45210, 37376, 262, 64),
    ),
    exitCode: 0,
  },
} as const satisfies Record<string, FakeScenario>;

export type CodexScenarioName = keyof typeof CODEX_SCENARIOS;
