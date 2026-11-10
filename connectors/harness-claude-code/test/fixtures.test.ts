import type { FakeScenario } from '@mwc/harness-core/fake';
import { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_ID, CLAUDE_SCENARIOS, CLAUDE_SESSION_ID, EXPLORE_ID, TODO_ID } from '../src/fixtures.ts';
import { ClaudeLineParser } from '../src/parser.ts';

/** Plays a scenario through a parser as the runner will: every line, then the end. */
function play(scenario: FakeScenario): TurnEvent[] {
  const parser = new ClaudeLineParser();
  const events = scenario.lines.flatMap((line) => parser.feed(line));
  return [...events, ...parser.end(scenario.exitCode, scenario.stderr ?? '')];
}

const session = { type: 'session', sessionId: CLAUDE_SESSION_ID };
/** The uuid of the fixtures' `assistant(n)` message: the result's `messageId` when it is the main agent's last. */
const messageId = (n: number) => `c0a80101-0000-4000-8000-${String(100 + n).padStart(12, '0')}`;
const init = {
  type: 'init',
  model: 'claude-opus-5-5',
  cwd: '/home/agent/work',
  slashCommands: ['compact', 'context', 'cost'],
};
/** The context after the main agent's message `n`: it read `13600 + 400 n` tokens from the cache. */
const context = (n: number) => ({
  type: 'context',
  inputTokens: 3,
  cacheReadTokens: 13600 + 400 * n,
  cacheCreationTokens: 0,
  outputTokens: 20,
  window: 1_000_000,
});
const usage = {
  type: 'usage',
  inputTokens: 15203,
  outputTokens: 9,
  cachedInputTokens: 14000,
  costUsd: 0.0312,
};

describe('the Claude Code fixtures', () => {
  it('are JSON lines whose events are all valid on the wire', () => {
    for (const scenario of Object.values(CLAUDE_SCENARIOS)) {
      for (const line of scenario.lines) expect(() => JSON.parse(line)).not.toThrow();
      for (const event of play(scenario)) expect(TurnEvent.parse(event)).toEqual(event);
    }
  });

  it('answer: the session, what it runs on, the text, the context, the usage and the reply', () => {
    expect(play(CLAUDE_SCENARIOS.answer)).toEqual([
      session,
      init,
      { type: 'text', text: '2 + 2 = 4.' },
      context(1),
      usage,
      { type: 'result', ok: true, text: '2 + 2 = 4.', durationMs: 2310, messageId: messageId(1) },
    ]);
  });

  it('tool: the thinking, the call with its command, its result, then the answer', () => {
    expect(play(CLAUDE_SCENARIOS.tool)).toEqual([
      session,
      init,
      { type: 'thinking', text: 'List the folder first.' },
      { type: 'tool', id: 'toolu_01FixtureLs', name: 'Bash', summary: 'ls src' },
      context(1),
      { type: 'tool_result', id: 'toolu_01FixtureLs', ok: true, summary: 'index.ts\nmain.ts' },
      { type: 'text', text: 'src holds index.ts and main.ts.' },
      context(2),
      usage,
      {
        type: 'result',
        ok: true,
        text: 'src holds index.ts and main.ts.',
        durationMs: 2310,
        messageId: messageId(2),
      },
    ]);
  });

  it('denied: the refused call fails and a notice says so before the result', () => {
    expect(play(CLAUDE_SCENARIOS.denied)).toEqual([
      session,
      init,
      { type: 'tool', id: 'toolu_01FixtureRm', name: 'Bash', summary: 'rm -rf build' },
      context(1),
      {
        type: 'tool_result',
        id: 'toolu_01FixtureRm',
        ok: false,
        summary: "Claude requested permissions to use Bash, but you haven't granted it yet.",
      },
      { type: 'text', text: 'Removing build needs your approval, so I left it.' },
      context(2),
      { type: 'notice', level: 'warn', message: 'Refused for permission: Bash (rm -rf build)' },
      usage,
      {
        type: 'result',
        ok: true,
        text: 'Removing build needs your approval, so I left it.',
        durationMs: 2310,
        messageId: messageId(2),
      },
    ]);
  });

  it('error: a failing result with Claude Code’s words (its own message has no context), and nothing more at the exit', () => {
    expect(play(CLAUDE_SCENARIOS.error)).toEqual([
      session,
      init,
      { type: 'text', text: 'Invalid API key · Please run /login' },
      { type: 'usage', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 },
      {
        type: 'result',
        ok: false,
        error: 'Invalid API key · Please run /login',
        durationMs: 412,
        messageId: messageId(1),
      },
    ]);
  });

  it('resume: the same session continues', () => {
    const events = play(CLAUDE_SCENARIOS.resume);
    expect(events[0]).toEqual(session);
    expect(events.at(-1)).toEqual({
      type: 'result',
      ok: true,
      text: 'Doubled, that is 8.',
      durationMs: 1804,
      messageId: messageId(1),
    });
  });

  it('subagent: the plan, the to-do list, an Explore subagent with its own steps, one in the background', () => {
    const explore = {
      type: 'subagent',
      id: EXPLORE_ID,
      agentType: 'Explore',
      description: 'Find the parser',
      model: 'haiku',
      background: false,
    };
    const tests = {
      type: 'subagent',
      id: BACKGROUND_ID,
      agentType: 'general-purpose',
      description: 'Run the tests',
      background: true,
    };
    const answer = 'The parser is in src/parser.ts.';
    const reply = 'The parser is in src/parser.ts, and the tests pass.';
    const trailer =
      'agentId: a1b2c3d4 (use SendMessage to continue this agent)\n<usage>total_tokens: 9120\ntool_uses: 1\nduration_ms: 3410</usage>';
    const grep = 'toolu_01FixtureSubGrep';
    expect(play(CLAUDE_SCENARIOS.subagent)).toEqual([
      session,
      init,
      { type: 'thinking', text: 'Plan it, then look for the parser.' },
      context(1),
      { type: 'tool', id: TODO_ID, name: 'TodoWrite', summary: '2 to-dos' },
      {
        type: 'todo',
        items: [
          { text: 'Find the parser', status: 'in_progress' },
          { text: 'Run the tests', status: 'pending' },
        ],
      },
      { type: 'tool_result', id: TODO_ID, ok: true, summary: 'Todos have been modified successfully.' },
      { type: 'tool', id: EXPLORE_ID, name: 'Agent', summary: 'Find the parser' },
      { ...explore, status: 'running' },
      context(2),
      { type: 'tool', id: grep, name: 'Grep', summary: 'parseJsonLine in src', parentId: EXPLORE_ID },
      { ...explore, status: 'running', lastStep: 'Running Grep' },
      {
        type: 'tool_result',
        id: grep,
        ok: true,
        summary: 'src/parser.ts:21:    const message = parseJsonLine(line);',
        parentId: EXPLORE_ID,
      },
      { type: 'text', text: answer, parentId: EXPLORE_ID },
      { type: 'tool_result', id: EXPLORE_ID, ok: true, summary: `${answer}\n${trailer}` },
      { ...explore, status: 'done', lastStep: 'Running Grep', summary: answer },
      { type: 'tool', id: BACKGROUND_ID, name: 'Agent', summary: 'Run the tests' },
      { ...tests, status: 'running' },
      context(3),
      {
        type: 'tool_result',
        id: BACKGROUND_ID,
        ok: true,
        summary: 'Async agent launched successfully.\nagentId: e5f6a7b8',
      },
      { ...tests, status: 'done', summary: 'All 214 tests pass.' },
      { type: 'text', text: reply },
      context(4),
      usage,
      { type: 'result', ok: true, text: reply, durationMs: 2310, messageId: messageId(4) },
    ]);
  });

  it('compact: the compaction with its sizes, then the usage and an empty reply', () => {
    expect(play(CLAUDE_SCENARIOS.compact)).toEqual([
      session,
      init,
      { type: 'compact', preTokens: 152340, postTokens: 18210, trigger: 'manual' },
      { type: 'usage', inputTokens: 8, outputTokens: 2410, cachedInputTokens: 0, costUsd: 0.2104 },
      { type: 'result', ok: true, durationMs: 41200 },
    ]);
  });
});
