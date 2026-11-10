import type { Harness } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import type { RunnerTools, ToolsOutput } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import type { FoundTools } from '../../src/tools/find.ts';
import type { ToolsHost } from '../../src/tools/host.ts';
import { Tools, type ToolsDeps } from '../../src/tools/tools.ts';
import type { HarnessHost } from '../../src/turns/turns.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

const NPM = '/opt/node/bin/npm';
const NONE: RunnerTools = { claude: null, codex: null, git: 'git version 2.39.5', gh: null, docker: null };
const WITH_CODEX: RunnerTools = { ...NONE, codex: 'codex-cli 0.163.0' };
const CODEX_CLI = { path: '/home/ihor/.local/bin/codex', version: 'codex-cli 0.163.0' };

/** A machine whose search answers the next of `searches` (the last one again after), with npm unless told. */
function toolsHost(searches: FoundTools[], overrides: Partial<ToolsHost> = {}) {
  const asked: number[] = [];
  const host: ToolsHost = {
    find: async () => {
      asked.push(asked.length);
      return (searches.length > 1 ? searches.shift() : searches[0]) as FoundTools;
    },
    npm: () => NPM,
    home: '/home/ihor',
    env: { HOME: '/home/ihor', PATH: '/usr/bin' },
    container: false,
    ...overrides,
  };
  return { host, asked };
}

/** Harnesses that record which ones were told to look again. */
function harnesses(versions = { claude_code: null, codex: null } as Record<Harness, string | null>) {
  const lookedFor: Harness[] = [];
  const harness = {
    versions,
    findAgain: async (name: Harness) => {
      lookedFor.push(name);
      return true;
    },
  } as unknown as HarnessHost;
  return { harness, lookedFor };
}

function tools(deps: Partial<ToolsDeps> = {}) {
  const sent: ToolsOutput[] = [];
  const changes: number[] = [];
  const spawn = new FakeSpawn();
  const time = new FakeTime();
  const logs = memoryLog();
  const made = new Tools({
    host: undefined,
    found: undefined,
    processes: { spawn: spawn.spawn, killGroup: spawn.killGroup },
    harness: undefined,
    timers: time,
    log: logs.log,
    send: (frame) => sent.push(frame) > 0,
    changed: () => changes.push(changes.length),
    ...deps,
  });
  return { tools: made, sent, changes, spawn, time, logs };
}

const check = () => ({ type: 'tools.check', cmdId: newId() }) as const;
const install = (tool: 'claude' | 'codex' = 'codex') =>
  ({ type: 'tools.install', cmdId: newId(), tool, version: '0.163.0' }) as const;

describe('the runner’s tools', () => {
  it('say nothing and refuse everything without a search', async () => {
    const { tools: none } = tools({ processes: undefined });
    expect(none.current).toBeUndefined();
    const frame = check();
    expect(await none.handle(frame)).toEqual({
      type: 'tools.result',
      cmdId: frame.cmdId,
      ok: false,
      error: 'unsupported: this runner does not report its tools',
    });
    expect((await none.handle(install())).error).toBe('unsupported: this runner does not install tools');
  });

  it('say the versions found at start, with a harness CLI the harnesses found since', () => {
    const { harness } = harnesses({ claude_code: '2.1.319 (Claude Code)', codex: null });
    const { tools: some } = tools({ found: NONE, harness });
    expect(some.current).toEqual({ ...NONE, claude: '2.1.319 (Claude Code)' });
  });

  it('look again on tools.check: the harnesses look for a harness CLI found now, then runner.caps, then the answer', async () => {
    const { host, asked } = toolsHost([{ versions: WITH_CODEX, clis: { codex: CODEX_CLI } }]);
    const { harness, lookedFor } = harnesses();
    const { tools: some, changes } = tools({ host, found: NONE, harness });
    const frame = check();
    expect(await some.handle(frame)).toEqual({
      type: 'tools.result',
      cmdId: frame.cmdId,
      ok: true,
      tools: WITH_CODEX,
    });
    expect([asked, lookedFor, changes]).toEqual([[0], ['codex'], [0]]);
    expect(some.current).toEqual(WITH_CODEX);
  });

  it('install with npm, pass its lines on, and answer with the versions read again', async () => {
    const { host, asked } = toolsHost([{ versions: WITH_CODEX, clis: { codex: CODEX_CLI } }]);
    const { tools: some, sent, changes, spawn, logs } = tools({ host, found: NONE });
    spawn.when(NPM, (child) => {
      child.stdout?.write('added 2 packages in 4s\n');
      child.exit(0);
    });
    const frame = install();
    expect(await some.handle(frame)).toEqual({
      type: 'tools.result',
      cmdId: frame.cmdId,
      ok: true,
      tools: WITH_CODEX,
    });
    expect(spawn.of(NPM).map((call) => call.args)).toEqual([
      ['install', '-g', '--prefix', '/home/ihor/.local', '@openai/codex@0.163.0'],
    ]);
    expect(sent).toEqual([{ type: 'tools.output', cmdId: frame.cmdId, line: 'added 2 packages in 4s' }]);
    expect([asked, changes]).toEqual([[0], [0]]);
    expect(logs.messages()).toEqual(['installing a tool', 'tools', 'tool install ended']);
  });

  it('answer a failed install with npm’s words and the versions read again', async () => {
    const { host } = toolsHost([{ versions: NONE, clis: {} }]);
    const { tools: some, spawn, changes } = tools({ host, found: NONE });
    spawn.when(NPM, (child) => child.exit(1));
    const frame = install('claude');
    expect(await some.handle(frame)).toEqual({
      type: 'tools.result',
      cmdId: frame.cmdId,
      ok: false,
      tools: NONE,
      error: 'failed: npm exited with code 1',
    });
    expect(changes).toEqual([0]);
  });

  it('install one at a time, and kill the one under way when the runner stops', async () => {
    const { host } = toolsHost([{ versions: NONE, clis: {} }]);
    const { tools: some, spawn } = tools({ host, found: NONE });
    const first = install('claude');
    const running = some.handle(first);
    const second = install();
    expect(await some.handle(second)).toEqual({
      type: 'tools.result',
      cmdId: second.cmdId,
      ok: false,
      error: 'busy: claude is being installed',
      tools: NONE,
    });
    some.stop();
    expect((await running).error).toBe('failed: npm was ended by SIGKILL');
    expect(spawn.groupKills).toEqual([{ pid: 4000, signal: 'SIGKILL' }]);
    some.stop();
  });

  it('install nothing in a container, without npm, or without a way to start a process', async () => {
    const container = toolsHost([{ versions: NONE, clis: {} }], { container: true });
    expect((await tools({ host: container.host, found: NONE }).tools.handle(install())).error).toBe(
      'unsupported: a container gets its CLIs from its image; rebuild the image instead',
    );
    const noNpm = toolsHost([{ versions: NONE, clis: {} }], { npm: () => undefined });
    const without = tools({ host: noNpm.host, found: NONE });
    expect((await without.tools.handle(install())).error).toBe(
      "npm_missing: there is no npm beside the runner's Node",
    );
    expect(without.spawn.calls).toEqual([]);
    const noProcesses = toolsHost([{ versions: NONE, clis: {} }]);
    expect(
      (await tools({ host: noProcesses.host, processes: undefined }).tools.handle(install())).error,
    ).toBe('unsupported: this runner does not install tools');
  });

  it('kill npm after the install timeout it is given', async () => {
    const { host } = toolsHost([{ versions: NONE, clis: {} }]);
    const { tools: some, spawn, time } = tools({ host, found: NONE, installTimeoutMs: 120_000 });
    spawn.when(NPM, (child) => {
      child.dies = false;
    });
    const running = some.handle(install());
    await time.advance(120_000);
    expect((await running).error).toBe('timeout: npm did not finish within 2 minutes');
  });
});
