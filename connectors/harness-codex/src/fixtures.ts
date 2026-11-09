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

const LS = "/bin/zsh -lc 'ls src'";
const RM = "/bin/zsh -lc 'rm -rf build'";
const TOUCH = "/bin/zsh -lc 'touch /etc/hosts'";
const AUTH_ERROR =
  'unexpected status 401 Unauthorized: Your access token could not be refreshed. Please log out and sign in again.';

/** The five turns: an answer, a tool call, a refused command, an error, and a resume of the first. */
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
} as const satisfies Record<string, FakeScenario>;

export type CodexScenarioName = keyof typeof CODEX_SCENARIOS;
