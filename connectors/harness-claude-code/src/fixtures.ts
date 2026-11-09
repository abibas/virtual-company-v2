import type { FakeScenario } from '@mwc/harness-core/fake';

/**
 * Recorded-style turns of `claude -p --output-format stream-json --verbose` (2.1.x), written from the CLI's documented
 * stream format, never recorded from a real turn (that would spend a subscription). The connector's tests parse them;
 * the runner's tests play them with the fake binary of `@mwc/harness-core/fake`.
 */

/** The conversation every scenario belongs to (the resume continues it). */
export const CLAUDE_SESSION_ID = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';

const MODEL = 'claude-opus-5-5';

const init = {
  type: 'system',
  subtype: 'init',
  cwd: '/home/agent/work',
  session_id: CLAUDE_SESSION_ID,
  tools: ['Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'TodoWrite'],
  mcp_servers: [],
  model: MODEL,
  permissionMode: 'default',
  slash_commands: ['compact', 'context', 'cost'],
  apiKeySource: 'none',
  claude_code_version: '2.1.319',
  output_style: 'default',
  uuid: 'c0a80101-0000-4000-8000-000000000001',
};

const usage = (input: number, written: number, read: number, output: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: written,
  cache_read_input_tokens: read,
  output_tokens: output,
  service_tier: 'standard',
});

function assistant(n: number, content: readonly object[]) {
  return {
    type: 'assistant',
    message: {
      id: `msg_01Fixture${n}`,
      type: 'message',
      role: 'assistant',
      model: MODEL,
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: usage(3, 0, 14000, 20),
    },
    parent_tool_use_id: null,
    session_id: CLAUDE_SESSION_ID,
    uuid: `c0a80101-0000-4000-8000-00000000010${n}`,
  };
}

function toolResult(id: string, content: string, isError: boolean) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ tool_use_id: id, type: 'tool_result', content, is_error: isError }],
    },
    parent_tool_use_id: null,
    session_id: CLAUDE_SESSION_ID,
    uuid: 'c0a80101-0000-4000-8000-000000000201',
  };
}

function result(reply: string, extra: object = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2310,
    duration_api_ms: 2104,
    num_turns: 1,
    result: reply,
    stop_reason: 'end_turn',
    session_id: CLAUDE_SESSION_ID,
    total_cost_usd: 0.0312,
    usage: usage(3, 1200, 14000, 9),
    permission_denials: [],
    uuid: 'c0a80101-0000-4000-8000-000000000301',
    ...extra,
  };
}

const lines = (...messages: readonly object[]) => messages.map((message) => JSON.stringify(message));

const BASH_LS = { command: 'ls src', description: 'List the source folder' };
const BASH_RM = { command: 'rm -rf build', description: 'Remove the build folder' };
const AUTH_ERROR = 'Invalid API key · Please run /login';

/** The five turns: an answer, a tool call, a tool refused for permission, an error, and a resume of the first. */
export const CLAUDE_SCENARIOS = {
  answer: {
    lines: lines(init, assistant(1, [{ type: 'text', text: '2 + 2 = 4.' }]), result('2 + 2 = 4.')),
    exitCode: 0,
  },
  tool: {
    lines: lines(
      init,
      assistant(1, [
        { type: 'thinking', thinking: 'List the folder first.', signature: 'c2lnbmF0dXJl' },
        { type: 'tool_use', id: 'toolu_01FixtureLs', name: 'Bash', input: BASH_LS },
      ]),
      toolResult('toolu_01FixtureLs', 'index.ts\nmain.ts', false),
      assistant(2, [{ type: 'text', text: 'src holds index.ts and main.ts.' }]),
      result('src holds index.ts and main.ts.', { num_turns: 2 }),
    ),
    exitCode: 0,
  },
  denied: {
    lines: lines(
      init,
      assistant(1, [{ type: 'tool_use', id: 'toolu_01FixtureRm', name: 'Bash', input: BASH_RM }]),
      toolResult(
        'toolu_01FixtureRm',
        "Claude requested permissions to use Bash, but you haven't granted it yet.",
        true,
      ),
      assistant(2, [{ type: 'text', text: 'Removing build needs your approval, so I left it.' }]),
      result('Removing build needs your approval, so I left it.', {
        num_turns: 2,
        permission_denials: [{ tool_name: 'Bash', tool_use_id: 'toolu_01FixtureRm', tool_input: BASH_RM }],
      }),
    ),
    exitCode: 0,
  },
  error: {
    lines: lines(
      init,
      assistant(1, [{ type: 'text', text: AUTH_ERROR }]),
      result(AUTH_ERROR, { is_error: true, duration_ms: 412, total_cost_usd: 0, usage: usage(0, 0, 0, 0) }),
    ),
    exitCode: 1,
  },
  resume: {
    lines: lines(
      init,
      assistant(1, [{ type: 'text', text: 'Doubled, that is 8.' }]),
      result('Doubled, that is 8.', { duration_ms: 1804, total_cost_usd: 0.0041 }),
    ),
    exitCode: 0,
  },
} as const satisfies Record<string, FakeScenario>;

export type ClaudeScenarioName = keyof typeof CLAUDE_SCENARIOS;
