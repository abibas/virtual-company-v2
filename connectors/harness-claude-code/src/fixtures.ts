import type { FakeScenario } from '@mwc/harness-core/fake';
import { assistant, CLAUDE_SESSION_ID, init, lines, result, toolResult, usage } from './fixtures/build.ts';
import { SUBAGENT_SCENARIOS } from './fixtures/subagents.ts';

/**
 * Recorded-style turns of `claude -p --output-format stream-json --verbose` (2.1.x), written from the CLI's documented
 * stream format, never recorded from a real turn (that would spend a subscription). The connector's tests parse them;
 * the runner's tests play them with the fake binary of `@mwc/harness-core/fake`. Their messages are `fixtures/build.ts`'s.
 */

export { BACKGROUND_ID, EXPLORE_ID, TODO_ID } from './fixtures/subagents.ts';
export { CLAUDE_SESSION_ID };

const BASH_LS = { command: 'ls src', description: 'List the source folder' };
const BASH_RM = { command: 'rm -rf build', description: 'Remove the build folder' };
const AUTH_ERROR = 'Invalid API key · Please run /login';

/**
 * The turns: an answer, a tool call, a tool refused for permission, an error, a resume of the first, one with a to-do
 * list and subagents, and a `/compact`.
 */
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
      assistant(1, [{ type: 'text', text: AUTH_ERROR }], { model: '<synthetic>', usage: usage(0, 0, 0, 0) }),
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
  ...SUBAGENT_SCENARIOS,
} as const satisfies Record<string, FakeScenario>;

export type ClaudeScenarioName = keyof typeof CLAUDE_SCENARIOS;
