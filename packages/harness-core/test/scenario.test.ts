import { describe, expect, it } from 'vitest';
import {
  FAKE_HARNESS_SCENARIO_ENV,
  type FakeHarnessIo,
  parseScenario,
  runFakeHarness,
} from '../src/scenario.ts';

/** The fake binary's process, in memory: files by path, what it printed, the waits. */
function fakeIo(files: Record<string, string>, env: Record<string, string> = {}, stdin = 'the prompt') {
  const out: string[] = [];
  const err: string[] = [];
  const waits: number[] = [];
  const written: Record<string, string> = {};
  const io: FakeHarnessIo = {
    argv: ['-p', '--verbose'],
    env: { [FAKE_HARNESS_SCENARIO_ENV]: '/s.json', HOME: '/home/agent', SECRET: 'never recorded', ...env },
    cwd: '/home/agent/work',
    readStdin: async () => stdin,
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    writeFile: async (path, text) => {
      written[path] = text;
    },
    writeStdout: (text) => out.push(text),
    writeStderr: (text) => err.push(text),
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
  return { io, out, err, waits, written };
}

describe('runFakeHarness', () => {
  it('prints the lines, then stderr, and exits with the code', async () => {
    const scenario = { lines: ['{"a":1}', '{"b":2}'], stderr: 'warn\n', exitCode: 3 };
    const w = fakeIo({ '/s.json': JSON.stringify(scenario) });
    expect(await runFakeHarness(w.io)).toBe(3);
    expect(w.out).toEqual(['{"a":1}\n', '{"b":2}\n']);
    expect(w.err).toEqual(['warn\n']);
    expect(w.waits).toEqual([]);
    expect(w.written).toEqual({});
  });

  it('waits before each line and after the last, and records only the variables asked for', async () => {
    const scenario = {
      lines: ['x', 'y'],
      exitCode: 0,
      delayMs: 5,
      holdMs: 50,
      record: '/record.json',
      recordEnv: ['HOME', 'MISSING'],
    };
    const w = fakeIo({ '/s.json': JSON.stringify(scenario) });
    expect(await runFakeHarness(w.io)).toBe(0);
    expect(w.waits).toEqual([5, 5, 50]);
    expect(JSON.parse(w.written['/record.json'] as string)).toEqual({
      argv: ['-p', '--verbose'],
      cwd: '/home/agent/work',
      stdin: 'the prompt',
      env: { HOME: '/home/agent' },
    });
  });

  it('records no variables when none are asked for', async () => {
    const w = fakeIo({ '/s.json': JSON.stringify({ lines: [], exitCode: 0, record: '/r.json' }) });
    await runFakeHarness(w.io);
    expect(JSON.parse(w.written['/r.json'] as string).env).toEqual({});
  });

  it('exits 2 with a message when the scenario is missing, unreadable or not a scenario', async () => {
    const unset = fakeIo({}, { [FAKE_HARNESS_SCENARIO_ENV]: '' });
    expect(await runFakeHarness(unset.io)).toBe(2);
    expect(unset.err).toEqual(['fake-harness: FAKE_HARNESS_SCENARIO is not set\n']);
    const missing = fakeIo({});
    expect(await runFakeHarness(missing.io)).toBe(2);
    expect(missing.err[0]).toContain('ENOENT');
    const wrong = fakeIo({ '/s.json': '{"lines":"x","exitCode":0}' });
    expect(await runFakeHarness(wrong.io)).toBe(2);
    expect(wrong.err).toEqual(['fake-harness: Not a fake harness scenario\n']);
    expect(wrong.out).toEqual([]);
  });
});

describe('parseScenario', () => {
  it('takes a scenario with its optional fields', () => {
    const full = {
      lines: ['a'],
      stderr: 'e',
      exitCode: 1,
      delayMs: 0,
      holdMs: 10,
      record: '/r',
      recordEnv: ['A'],
    };
    expect(parseScenario(JSON.stringify(full))).toEqual(full);
  });

  it('refuses anything else', () => {
    for (const bad of [
      [],
      { lines: [1], exitCode: 0 },
      { lines: [], exitCode: 1.5 },
      { lines: [], exitCode: 0, stderr: 1 },
      { lines: [], exitCode: 0, delayMs: -1 },
      { lines: [], exitCode: 0, holdMs: 'x' },
      { lines: [], exitCode: 0, record: 1 },
      { lines: [], exitCode: 0, recordEnv: [1] },
    ]) {
      expect(() => parseScenario(JSON.stringify(bad))).toThrow(TypeError);
    }
    expect(() => parseScenario('{')).toThrow(SyntaxError);
  });
});
