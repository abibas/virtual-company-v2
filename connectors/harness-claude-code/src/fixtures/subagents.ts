import type { FakeScenario } from '@mwc/harness-core/fake';
import { assistant, init, lines, MODEL, modelUsage, result, system, toolResult, usage } from './build.ts';

/**
 * The richer recorded-style turns: one that plans with `TodoWrite`, sends an Explore subagent (its own steps carry its
 * call's id, Claude Code reports it with `task_*` messages) and one in the background (its call answers at once, its
 * end comes as `task_notification`); and a `/compact` turn.
 */

export const TODO_ID = 'toolu_01FixtureTodo';
export const EXPLORE_ID = 'toolu_01FixtureExplore';
export const BACKGROUND_ID = 'toolu_01FixtureTests';
const GREP_ID = 'toolu_01FixtureSubGrep';
const SUBAGENT_MODEL = 'claude-haiku-5-5';

const TODOS = {
  todos: [
    { content: 'Find the parser', status: 'in_progress', activeForm: 'Finding the parser' },
    { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' },
  ],
};
const EXPLORE = {
  description: 'Find the parser',
  prompt: 'Find where the stream-json lines are parsed.',
  subagent_type: 'Explore',
  model: 'haiku',
};
const TESTS = {
  description: 'Run the tests',
  prompt: 'Run the test suite and say whether it passes.',
  subagent_type: 'general-purpose',
  run_in_background: true,
};
const ANSWER = 'The parser is in src/parser.ts.';
const TRAILER =
  'agentId: a1b2c3d4 (use SendMessage to continue this agent)\n<usage>total_tokens: 9120\ntool_uses: 1\nduration_ms: 3410</usage>';
const REPLY = 'The parser is in src/parser.ts, and the tests pass.';

const subagent = (n: number, content: readonly object[]) =>
  assistant(n, content, { parent: EXPLORE_ID, model: SUBAGENT_MODEL, usage: usage(4, 0, 9000, 30) });

export const SUBAGENT_SCENARIOS = {
  subagent: {
    lines: lines(
      init,
      assistant(1, [{ type: 'thinking', thinking: 'Plan it, then look for the parser.', signature: 'c2ln' }]),
      assistant(1, [{ type: 'tool_use', id: TODO_ID, name: 'TodoWrite', input: TODOS }]),
      toolResult(TODO_ID, 'Todos have been modified successfully.', false),
      assistant(2, [{ type: 'tool_use', id: EXPLORE_ID, name: 'Agent', input: EXPLORE }]),
      system('task_started', {
        task_id: 'a1b2c3d4',
        tool_use_id: EXPLORE_ID,
        task_type: 'local_agent',
        subagent_type: 'Explore',
        description: 'Find the parser',
      }),
      subagent(1, [
        { type: 'tool_use', id: GREP_ID, name: 'Grep', input: { pattern: 'parseJsonLine', path: 'src' } },
      ]),
      system('task_progress', {
        task_id: 'a1b2c3d4',
        tool_use_id: EXPLORE_ID,
        description: 'Running Grep',
        usage: { total_tokens: 9034, tool_uses: 1, duration_ms: 1200 },
      }),
      toolResult(GREP_ID, 'src/parser.ts:21:    const message = parseJsonLine(line);', false, EXPLORE_ID),
      subagent(2, [{ type: 'text', text: ANSWER }]),
      toolResult(
        EXPLORE_ID,
        [
          { type: 'text', text: ANSWER },
          { type: 'text', text: TRAILER },
        ],
        false,
      ),
      assistant(3, [{ type: 'tool_use', id: BACKGROUND_ID, name: 'Agent', input: TESTS }]),
      toolResult(BACKGROUND_ID, 'Async agent launched successfully.\nagentId: e5f6a7b8', false),
      system('task_started', {
        task_id: 'e5f6a7b8',
        tool_use_id: BACKGROUND_ID,
        task_type: 'local_agent',
        is_backgrounded: true,
        description: 'Run the tests',
      }),
      system('task_updated', { task_id: 'e5f6a7b8', patch: { is_backgrounded: true } }),
      system('task_notification', {
        task_id: 'e5f6a7b8',
        tool_use_id: BACKGROUND_ID,
        status: 'completed',
        summary: 'All 214 tests pass.',
      }),
      assistant(4, [{ type: 'text', text: REPLY }]),
      result(REPLY, {
        num_turns: 4,
        modelUsage: { [MODEL]: modelUsage(1_000_000), [SUBAGENT_MODEL]: modelUsage(1_000_000) },
      }),
    ),
    exitCode: 0,
  },
  compact: {
    lines: lines(
      init,
      system('status', { status: 'compacting' }),
      system('compact_boundary', {
        compact_metadata: { trigger: 'manual', pre_tokens: 152340, post_tokens: 18210 },
      }),
      {
        type: 'user',
        message: { role: 'user', content: 'This session is being continued from a previous conversation…' },
        isCompactSummary: true,
        parent_tool_use_id: null,
      },
      system('status', { status: null }),
      result('', { num_turns: 0, duration_ms: 41200, total_cost_usd: 0.2104, usage: usage(8, 0, 0, 2410) }),
    ),
    exitCode: 0,
  },
} as const satisfies Record<string, FakeScenario>;
