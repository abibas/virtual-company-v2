import type { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { HarnessError, isHarnessError } from '../src/errors.ts';
import {
  FAKE_HARNESS_BIN,
  FakeHarnessDriver,
  fakeLines,
  fakeTerminalSpec,
  fakeTurnSpec,
} from '../src/fake.ts';

describe('FakeHarnessDriver', () => {
  it('records turns and terminals and builds specs from its defaults', () => {
    const driver = new FakeHarnessDriver();
    expect(driver.harness).toBe('claude_code');
    expect(driver.versionArgs).toEqual(['--version']);
    const turn = fakeTurnSpec('claude_code');
    expect(driver.turn(turn)).toEqual({
      command: 'fake-harness',
      args: ['turn'],
      env: {},
      unsetEnv: [],
      stdin: 'What is 2 + 2?',
      notices: [],
    });
    const terminal = fakeTerminalSpec('claude_code', { sessionId: 's-1' });
    expect(driver.terminal(terminal)).toMatchObject({ args: ['terminal', '--resume', 's-1'], stdin: null });
    expect(driver.turns).toEqual([turn]);
    expect(driver.terminals).toEqual([terminal]);
  });

  it('points at the fake binary with its options', () => {
    const notice = { type: 'notice', level: 'info', message: 'hello' } as const;
    const privateDir = {
      env: 'CODEX_HOME',
      path: null,
      files: [{ name: 'auth.json', contents: '{}', mode: 0o600 }],
    };
    const driver = new FakeHarnessDriver({
      harness: 'codex',
      command: '/usr/local/bin/node',
      args: [FAKE_HARNESS_BIN],
      env: { FAKE_HARNESS_SCENARIO: '/tmp/s.json' },
      unsetEnv: ['CODEX_API_KEY'],
      privateDir,
      notices: [notice],
    });
    expect(driver.turn(fakeTurnSpec('codex', { sessionId: 't-1' }))).toEqual({
      command: '/usr/local/bin/node',
      args: [FAKE_HARNESS_BIN, 'turn', '--resume', 't-1'],
      env: { FAKE_HARNESS_SCENARIO: '/tmp/s.json' },
      unsetEnv: ['CODEX_API_KEY'],
      stdin: 'What is 2 + 2?',
      privateDir,
      notices: [notice],
    });
    expect(FAKE_HARNESS_BIN.endsWith('/packages/harness-core/scripts/fake-harness.ts')).toBe(true);
  });

  it('runs the real checks and throws queued errors once', () => {
    const driver = new FakeHarnessDriver({ harness: 'codex' });
    expect(() => driver.turn(fakeTurnSpec('claude_code'))).toThrow(HarnessError);
    driver.failNext(new HarnessError('credential_mismatch'));
    try {
      driver.terminal(fakeTerminalSpec('codex'));
      expect.unreachable();
    } catch (error) {
      expect(isHarnessError(error, 'credential_mismatch')).toBe(true);
    }
    expect(driver.terminal(fakeTerminalSpec('codex')).args).toEqual(['terminal']);
    expect(driver.terminals).toHaveLength(1);
  });

  it('parses lines that are turn events and ignores the rest', () => {
    const events: TurnEvent[] = [
      { type: 'session', sessionId: 's-1' },
      { type: 'text', text: 'Hi' },
      { type: 'result', ok: true, text: 'Hi' },
    ];
    const parser = new FakeHarnessDriver().parser();
    const lines = ['garbage', '{"type":"thinking"}', '', ...fakeLines(events)];
    expect(lines.flatMap((line) => parser.feed(line))).toEqual(events);
    expect(parser.end(0, '')).toEqual([]);
  });

  it('ends with a failing result when no result came', () => {
    const parser = new FakeHarnessDriver({ harness: 'codex' }).parser();
    parser.feed(fakeLines([{ type: 'text', text: 'Hi' }])[0] as string);
    expect(parser.end(1, 'boom')).toEqual([
      { type: 'result', ok: false, error: 'Codex exited with code 1: boom' },
    ]);
  });
});
