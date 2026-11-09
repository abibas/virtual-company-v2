import { describe, expect, it } from 'vitest';
import { CODEX_AUTH_JSON_MAX } from '../../src/harness.ts';
import { RunnerHello } from '../../src/runner-protocol/runner-frames.ts';
import { TerminalExit, TerminalOpen } from '../../src/runner-protocol/terminal.ts';
import {
  HarnessVersions,
  harnessVersionOf,
  isTurnFrame,
  TURN_ERRORS,
  TurnEnd,
  TurnEvents,
  TurnStart,
  TurnStop,
} from '../../src/runner-protocol/turns.ts';
import { IDS, RUNNER_EXAMPLES, SERVER_EXAMPLES, TURN_SPEC } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

describe('runner.hello caps.harnesses', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];

  it("takes each CLI's version, null for a missing one, and a harness left out as null", () => {
    const parsed = RunnerHello.parse({ ...hello, caps: { ...hello.caps, harnesses: { claude_code: null } } });
    expect(parsed.caps.harnesses).toEqual({ claude_code: null, codex: null });
    expect(harnessVersionOf(parsed.caps.harnesses, 'claude_code')).toBeNull();
    const both = RunnerHello.parse(hello).caps.harnesses;
    expect(harnessVersionOf(both, 'claude_code')).toBe('2.1.319 (Claude Code)');
    expect(harnessVersionOf(both, 'codex')).toBe('codex-cli 0.163.0');
  });

  it('reads the names alone of a runner older than chats as no turn at all', () => {
    for (const harnesses of [['claude_code'], []]) {
      const parsed = RunnerHello.parse({ ...hello, caps: { ...hello.caps, harnesses } });
      expect(parsed.caps.harnesses).toEqual(harnesses);
      expect(harnessVersionOf(parsed.caps.harnesses, 'claude_code')).toBeUndefined();
    }
  });

  it('refuses an empty or too long version', () => {
    expect(issuesOf(HarnessVersions, { claude_code: '' })).toEqual(['claude_code']);
    expect(issuesOf(HarnessVersions, { codex: 'x'.repeat(101) })).toEqual(['codex']);
  });
});

describe('the turn frames', () => {
  it('start a turn with its spec, and refuse one without a turn id or with a bad spec', () => {
    const start = SERVER_EXAMPLES['turn.start'];
    expect(issuesOf(TurnStart, start)).toEqual([]);
    expect(issuesOf(TurnStart, { ...start, turnId: 'nope' })).toEqual(['turnId']);
    expect(issuesOf(TurnStart, { ...start, spec: { ...TURN_SPEC, prompt: '' } })).toEqual(['spec.prompt']);
    expect(issuesOf(TurnStart, { ...start, spec: { ...TURN_SPEC, cwd: 'relative' } })).toEqual(['spec.cwd']);
    expect(issuesOf(TurnStop, SERVER_EXAMPLES['turn.stop'])).toEqual([]);
  });

  it('carry 1 to 100 numbered events of the known types', () => {
    const events = RUNNER_EXAMPLES['turn.events'];
    expect(issuesOf(TurnEvents, events)).toEqual([]);
    expect(issuesOf(TurnEvents, { ...events, events: [] })).toEqual(['events']);
    const item = { seq: 1, event: { type: 'text', text: 'x' } };
    expect(issuesOf(TurnEvents, { ...events, events: Array(101).fill(item) })).toEqual(['events']);
    expect(issuesOf(TurnEvents, { ...events, events: [{ ...item, seq: 0 }] })).toEqual(['events.0.seq']);
    expect(issuesOf(TurnEvents, { ...events, events: [{ seq: 1, event: { type: 'thinking' } }] })).toEqual([
      'events.0.event.type',
    ]);
  });

  it('end a turn with its exit code (or null), an error and a rewritten Codex login', () => {
    const end = RUNNER_EXAMPLES['turn.end'];
    expect(issuesOf(TurnEnd, end)).toEqual([]);
    expect(issuesOf(TurnEnd, { ...end, ok: false, exitCode: null, error: 'busy' })).toEqual([]);
    expect(issuesOf(TurnEnd, { ...end, authJson: '{"tokens":{}}' })).toEqual([]);
    expect(issuesOf(TurnEnd, { ...end, authJson: '[1]' })).toEqual(['authJson']);
    expect(issuesOf(TurnEnd, { ...end, authJson: `{"a":"${'x'.repeat(CODEX_AUTH_JSON_MAX)}"}` })).toEqual([
      'authJson',
    ]);
    expect(issuesOf(TurnEnd, without(end, 'exitCode'))).toEqual(['exitCode']);
    expect(issuesOf(TurnEnd, { ...end, error: '' })).toEqual(['error']);
  });

  it('are told apart from the others, and name the runner’s own reasons', () => {
    expect(isTurnFrame(SERVER_EXAMPLES['turn.start'])).toBe(true);
    expect(isTurnFrame(RUNNER_EXAMPLES['turn.end'])).toBe(true);
    expect(isTurnFrame(SERVER_EXAMPLES['terminal.open'])).toBe(false);
    expect(TURN_ERRORS).toContain('unsupported');
    expect(IDS.turn).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("a chat's terminal", () => {
  it("opens the harness's TUI with a terminal spec, and its exit may carry the rewritten login", () => {
    const open = SERVER_EXAMPLES['terminal.open'];
    const { prompt: _prompt, ...spec } = TURN_SPEC;
    expect(issuesOf(TerminalOpen, { ...open, harness: spec })).toEqual([]);
    expect(TerminalOpen.parse(open).harness).toBeUndefined();
    expect(issuesOf(TerminalOpen, { ...open, harness: { ...spec, cwd: 'relative' } })).toEqual([
      'harness.cwd',
    ]);
    const exit = RUNNER_EXAMPLES['terminal.exit'];
    expect(issuesOf(TerminalExit, { ...exit, authJson: '{"OPENAI_API_KEY":null}' })).toEqual([]);
    expect(issuesOf(TerminalExit, { ...exit, authJson: 'not json' })).toEqual(['authJson']);
  });
});
