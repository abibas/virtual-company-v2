import type { FakeScenario } from '@mwc/harness-core/fake';
import { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { CLAUDE_SCENARIOS, CLAUDE_SESSION_ID } from '../src/fixtures.ts';
import { ClaudeLineParser } from '../src/parser.ts';

/** Plays a scenario through a parser as the runner will: every line, then the end. */
function play(scenario: FakeScenario): TurnEvent[] {
  const parser = new ClaudeLineParser();
  const events = scenario.lines.flatMap((line) => parser.feed(line));
  return [...events, ...parser.end(scenario.exitCode, scenario.stderr ?? '')];
}

const session = { type: 'session', sessionId: CLAUDE_SESSION_ID };
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

  it('answer: the session, the text, the usage and the reply', () => {
    expect(play(CLAUDE_SCENARIOS.answer)).toEqual([
      session,
      { type: 'text', text: '2 + 2 = 4.' },
      usage,
      { type: 'result', ok: true, text: '2 + 2 = 4.', durationMs: 2310 },
    ]);
  });

  it('tool: the call with its command, its result, then the answer', () => {
    expect(play(CLAUDE_SCENARIOS.tool)).toEqual([
      session,
      { type: 'tool', id: 'toolu_01FixtureLs', name: 'Bash', summary: 'ls src' },
      { type: 'tool_result', id: 'toolu_01FixtureLs', ok: true, summary: 'index.ts\nmain.ts' },
      { type: 'text', text: 'src holds index.ts and main.ts.' },
      usage,
      { type: 'result', ok: true, text: 'src holds index.ts and main.ts.', durationMs: 2310 },
    ]);
  });

  it('denied: the refused call fails and a notice says so before the result', () => {
    expect(play(CLAUDE_SCENARIOS.denied)).toEqual([
      session,
      { type: 'tool', id: 'toolu_01FixtureRm', name: 'Bash', summary: 'rm -rf build' },
      {
        type: 'tool_result',
        id: 'toolu_01FixtureRm',
        ok: false,
        summary: "Claude requested permissions to use Bash, but you haven't granted it yet.",
      },
      { type: 'text', text: 'Removing build needs your approval, so I left it.' },
      { type: 'notice', level: 'warn', message: 'Refused for permission: Bash (rm -rf build)' },
      usage,
      {
        type: 'result',
        ok: true,
        text: 'Removing build needs your approval, so I left it.',
        durationMs: 2310,
      },
    ]);
  });

  it('error: a failing result with Claude Code’s words, and nothing more at the exit', () => {
    expect(play(CLAUDE_SCENARIOS.error)).toEqual([
      session,
      { type: 'text', text: 'Invalid API key · Please run /login' },
      { type: 'usage', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 },
      { type: 'result', ok: false, error: 'Invalid API key · Please run /login', durationMs: 412 },
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
    });
  });
});
