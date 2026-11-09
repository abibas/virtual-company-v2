import { describe, expect, it } from 'vitest';
import { RunnerHello } from '../../src/runner-protocol/runner-frames.ts';
import {
  base64Bytes,
  isTerminalFrame,
  TERMINAL_DATA_MAX_BYTES,
  TerminalData,
  TerminalExit,
  TerminalInput,
  TerminalOpen,
  TerminalOpened,
  TerminalResize,
  TerminalToBrowser,
  TerminalToServer,
} from '../../src/runner-protocol/terminal.ts';
import { RUNNER_EXAMPLES, SERVER_EXAMPLES } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

const base64Of = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64');

describe('runner.hello caps.terminal', () => {
  it('is false for a runner older than the terminal, and a boolean otherwise', () => {
    const hello = RUNNER_EXAMPLES['runner.hello'];
    const older = { ...hello, caps: without(hello.caps, 'terminal') };
    expect(RunnerHello.parse(older).caps.terminal).toBe(false);
    expect(RunnerHello.parse(hello).caps.terminal).toBe(true);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...hello.caps, terminal: 'yes' } })).toEqual([
      'caps.terminal',
    ]);
  });
});

describe('terminal data', () => {
  it('is padded base64 of 1 to 64 KB, counted in decoded bytes', () => {
    expect(base64Bytes(base64Of(1))).toBe(1);
    expect(base64Bytes(base64Of(2))).toBe(2);
    expect(base64Bytes(base64Of(3))).toBe(3);
    expect(issuesOf(TerminalData, base64Of(TERMINAL_DATA_MAX_BYTES))).toEqual([]);
    expect(issuesOf(TerminalData, base64Of(TERMINAL_DATA_MAX_BYTES + 1))).toEqual(['']);
    // The longest text allowed, unpadded: 65,538 bytes.
    expect(issuesOf(TerminalData, 'A'.repeat(87_384))).toEqual(['']);
    expect(issuesOf(TerminalData, '')).toEqual(['']);
    expect(issuesOf(TerminalData, 'aGVsbG8')).toEqual(['']);
    expect(issuesOf(TerminalData, 'aGVs bG8=')).toEqual(['']);
  });
});

describe('the terminal frames', () => {
  it('take a size of 2–500 columns and 1–300 rows', () => {
    const open = SERVER_EXAMPLES['terminal.open'];
    expect(issuesOf(TerminalOpen, { ...open, cols: 2, rows: 1 })).toEqual([]);
    expect(issuesOf(TerminalOpen, { ...open, cols: 500, rows: 300 })).toEqual([]);
    expect(issuesOf(TerminalOpen, { ...open, cols: 1, rows: 0 })).toEqual(['cols', 'rows']);
    expect(issuesOf(TerminalResize, { ...SERVER_EXAMPLES['terminal.resize'], cols: 501, rows: 301 })).toEqual(
      ['cols', 'rows'],
    );
    expect(issuesOf(TerminalOpen, { ...open, cols: 80.5 })).toEqual(['cols']);
  });

  it('name their session by id and carry base64 bytes', () => {
    expect(issuesOf(TerminalInput, { ...SERVER_EXAMPLES['terminal.input'], sessionId: 'tty1' })).toEqual([
      'sessionId',
    ]);
    expect(issuesOf(TerminalInput, { ...SERVER_EXAMPLES['terminal.input'], data: 'ls\r' })).toEqual(['data']);
    expect(issuesOf(TerminalOpened, { ...RUNNER_EXAMPLES['terminal.opened'], shell: '' })).toEqual(['shell']);
  });

  it("end with the shell's code, or null with a signal, and why when the runner ended it", () => {
    const exit = RUNNER_EXAMPLES['terminal.exit'];
    expect(issuesOf(TerminalExit, { ...exit, code: 0, signal: undefined })).toEqual([]);
    expect(issuesOf(TerminalExit, { ...exit, error: 'idle_timeout' })).toEqual([]);
    expect(issuesOf(TerminalExit, without(exit, 'code'))).toEqual(['code']);
    expect(issuesOf(TerminalExit, { ...exit, code: 1.5, error: '' })).toEqual(['code', 'error']);
  });

  it('are told apart from the others by their type', () => {
    expect(isTerminalFrame(SERVER_EXAMPLES['terminal.close'])).toBe(true);
    expect(isTerminalFrame(RUNNER_EXAMPLES['terminal.output'])).toBe(true);
    expect(isTerminalFrame(SERVER_EXAMPLES['tunnel.set'])).toBe(false);
  });
});

describe("the browser socket's messages", () => {
  it('take typed input and a new size from the browser', () => {
    expect(TerminalToServer.parse({ type: 'input', data: 'ls -la\r' })).toEqual({
      type: 'input',
      data: 'ls -la\r',
    });
    expect(issuesOf(TerminalToServer, { type: 'resize', cols: 100, rows: 30 })).toEqual([]);
    expect(issuesOf(TerminalToServer, { type: 'input', data: '' })).toEqual(['data']);
    expect(issuesOf(TerminalToServer, { type: 'resize', cols: 1, rows: 30 })).toEqual(['cols']);
    expect(issuesOf(TerminalToServer, { type: 'close' })).toEqual(['type']);
  });

  it('give the browser the start, the output, the end and an error', () => {
    for (const message of [
      { type: 'opened', shell: '/bin/bash' },
      { type: 'output', data: 'aGk=' },
      { type: 'exit', code: null, error: 'machine_disconnected' },
      { type: 'error', code: 'machine_offline', message: 'The machine is offline' },
    ]) {
      expect(TerminalToBrowser.parse(message)).toEqual(message);
    }
  });
});
