import type { FakeScenario } from '@mwc/harness-core/fake';
import { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { CODEX_SCENARIOS, CODEX_THREAD_ID } from '../src/fixtures.ts';
import { CodexLineParser } from '../src/parser.ts';

/** Plays a scenario through a parser as the runner will: every line, then the end. */
function play(scenario: FakeScenario): TurnEvent[] {
  const parser = new CodexLineParser();
  const events = scenario.lines.flatMap((line) => parser.feed(line));
  return [...events, ...parser.end(scenario.exitCode, scenario.stderr ?? '')];
}

const session = { type: 'session', sessionId: CODEX_THREAD_ID };
/** The conversation's size Codex's turn total gives: the uncached input and the cache reads, marked an estimate. */
const estimate = (input: number, cached: number, output: number) => ({
  type: 'context',
  inputTokens: input - cached,
  cacheReadTokens: cached,
  cacheCreationTokens: 0,
  outputTokens: output,
  window: null,
  estimate: true,
});
const LS = "/bin/zsh -lc 'ls src'";

describe('the Codex fixtures', () => {
  it('are JSON lines whose events are all valid on the wire', () => {
    for (const scenario of Object.values(CODEX_SCENARIOS)) {
      for (const line of scenario.lines) expect(() => JSON.parse(line)).not.toThrow();
      for (const event of play(scenario)) expect(TurnEvent.parse(event)).toEqual(event);
    }
  });

  it('answer: the session, the reasoning, the text, the usage, and the reply at the clean exit', () => {
    expect(play(CODEX_SCENARIOS.answer)).toEqual([
      session,
      { type: 'thinking', text: '**Adding two numbers**' },
      { type: 'text', text: '2 + 2 = 4.' },
      { type: 'usage', inputTokens: 12034, outputTokens: 42, cachedInputTokens: 11008 },
      estimate(12034, 11008, 42),
      { type: 'result', ok: true, text: '2 + 2 = 4.' },
    ]);
  });

  it('tool: the command when it starts, its result, the file change, then the answer', () => {
    expect(play(CODEX_SCENARIOS.tool)).toEqual([
      session,
      { type: 'tool', id: 'item_1', name: 'command', summary: LS },
      { type: 'tool_result', id: 'item_1', ok: true, summary: 'exit 0: index.ts\nmain.ts' },
      { type: 'tool', id: 'item_2', name: 'file_change', summary: 'update /home/agent/work/src/main.ts' },
      { type: 'tool_result', id: 'item_2', ok: true, summary: 'applied' },
      { type: 'text', text: 'src holds index.ts and main.ts; I updated main.ts.' },
      { type: 'usage', inputTokens: 25411, outputTokens: 310, cachedInputTokens: 24064 },
      estimate(25411, 24064, 310),
      { type: 'result', ok: true, text: 'src holds index.ts and main.ts; I updated main.ts.' },
    ]);
  });

  it('denied: the declined command gives a notice, the sandboxed one a failed result', () => {
    const events = play(CODEX_SCENARIOS.denied);
    expect(events.slice(1, 6)).toEqual([
      { type: 'tool', id: 'item_1', name: 'command', summary: "/bin/zsh -lc 'rm -rf build'" },
      { type: 'tool_result', id: 'item_1', ok: false, summary: 'declined' },
      { type: 'notice', level: 'warn', message: "Refused for permission: /bin/zsh -lc 'rm -rf build'" },
      { type: 'tool', id: 'item_2', name: 'command', summary: "/bin/zsh -lc 'touch /etc/hosts'" },
      {
        type: 'tool_result',
        id: 'item_2',
        ok: false,
        summary: 'exit 1: touch: /etc/hosts: Operation not permitted',
      },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: true });
  });

  it('error: the error as a notice, then turn.failed ends it, and the exit adds nothing', () => {
    const error =
      'unexpected status 401 Unauthorized: Your access token could not be refreshed. Please log out and sign in again.';
    expect(play(CODEX_SCENARIOS.error)).toEqual([
      session,
      { type: 'notice', level: 'warn', message: error },
      { type: 'result', ok: false, error },
    ]);
  });

  it('resume: the same thread continues', () => {
    const events = play(CODEX_SCENARIOS.resume);
    expect(events[0]).toEqual(session);
    expect(events.at(-1)).toEqual({ type: 'result', ok: true, text: 'Doubled, that is 8.' });
  });

  it('steps: a turn of several model calls sums their input, so its context reads high (≈)', () => {
    const events = play(CODEX_SCENARIOS.steps);
    expect(events.filter((event) => event.type === 'tool')).toHaveLength(2);
    expect(events.slice(-3)).toEqual([
      { type: 'usage', inputTokens: 45210, outputTokens: 262, cachedInputTokens: 37376 },
      estimate(45210, 37376, 262),
      { type: 'result', ok: true, text: 'Both tests pass.' },
    ]);
  });

  it('plan: the to-do list as it is made and changes, the reasoning, the command, the answer', () => {
    const list = (done: number) => ({
      type: 'todo',
      items: [
        { text: 'Read the parser', status: done >= 1 ? 'completed' : 'pending' },
        { text: 'Add the reasoning event', status: done >= 2 ? 'completed' : 'pending' },
      ],
    });
    const cat = "/bin/zsh -lc 'cat src/parser.ts'";
    expect(play(CODEX_SCENARIOS.plan)).toEqual([
      session,
      list(0),
      { type: 'thinking', text: '**Reading the parser first**' },
      { type: 'tool', id: 'item_2', name: 'command', summary: cat },
      { type: 'tool_result', id: 'item_2', ok: true, summary: 'exit 0: export class CodexLineParser {' },
      list(1),
      { type: 'text', text: 'The parser reads reasoning items now.' },
      list(2),
      { type: 'usage', inputTokens: 30412, outputTokens: 512, cachedInputTokens: 28800 },
      estimate(30412, 28800, 512),
      { type: 'result', ok: true, text: 'The parser reads reasoning items now.' },
    ]);
  });
});
