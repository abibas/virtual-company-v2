import { newId } from '@mwc/shared/ids';
import type { RunnerTools } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalHost } from '../../../src/terminal/sessions.ts';
import type { ToolsHost } from '../../../src/tools/host.ts';
import type { SelfUpdate } from '../../../src/update/self-update.ts';
import { RESTART_DELAY_MS } from '../../../src/update/updates.ts';
import { cleanUpLinks, fakeServer } from '../../fixtures/link.ts';
import { FakePtySpawner } from '../../fixtures/pty.ts';
import { startRunner, stopRunners } from '../../fixtures/runner.ts';
import { FakeSpawn } from '../../fixtures/spawn.ts';

afterEach(async () => {
  await stopRunners();
  await cleanUpLinks();
});

const NPM = '/opt/node/bin/npm';
const NO_TOOLS: RunnerTools = { claude: null, codex: null, git: null, gh: null, docker: null };

/** A Linux machine with npm and no CLIs. */
const linuxTools = (): ToolsHost => ({
  find: async () => ({ versions: NO_TOOLS, clis: {} }),
  npm: () => NPM,
  home: '/home/ihor',
  env: { HOME: '/home/ihor', PATH: '/usr/bin' },
  container: false,
});

/** Resolves once `ready` holds, looking again every few milliseconds. */
async function eventually(ready: () => boolean): Promise<void> {
  for (let tries = 0; !ready(); tries++) {
    if (tries > 200) throw new Error('never ready');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const OLD = 'ab'.repeat(32);
const NEW = 'cd'.repeat(32);

/** A self-update that records the server it was asked to update from. */
function recordingUpdate() {
  const servers: string[] = [];
  const update: SelfUpdate = {
    manager: 'launchd',
    apply: async (serverUrl) => {
      servers.push(serverUrl);
      return { build: NEW, pty: true };
    },
  };
  return { update, servers };
}

describe("the runner's self-update on the wire", () => {
  it('says its build and that it updates itself, updates from its own server, and asks to restart', async () => {
    const server = await fakeServer();
    const { update, servers } = recordingUpdate();
    const { runner, time, config } = startRunner(server, { build: OLD, update });
    const hello = await server.frames.next('runner.hello');
    expect([hello.build, hello.caps.selfUpdate]).toEqual([OLD, true]);
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'runner.update', cmdId });
    expect(await server.frames.next('runner.update.result')).toEqual({
      type: 'runner.update.result',
      cmdId,
      ok: true,
      build: NEW,
    });
    expect(servers).toEqual([config.serverUrl]);
    let restarting = false;
    void runner.restart.then(() => {
      restarting = true;
    });
    await time.advance(RESTART_DELAY_MS);
    expect(restarting).toBe(true);
  });

  it('refuses while a tool is being installed', async () => {
    const server = await fakeServer();
    const spawn = new FakeSpawn().when(NPM, () => {});
    const tools = { host: linuxTools(), found: NO_TOOLS };
    startRunner(server, { spawn, tools, update: recordingUpdate().update });
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'tools.install', cmdId: newId(), tool: 'codex', version: '0.163.0' });
    await eventually(() => spawn.of(NPM).length === 1);
    server.send({ type: 'runner.update', cmdId: newId() });
    expect((await server.frames.next('runner.update.result')).error).toBe(
      'busy: codex is being installed; update it once it ends',
    );
  });

  it('refuses while a terminal is open, and when forced closes it with a notice before it restarts', async () => {
    const server = await fakeServer();
    const spawner = new FakePtySpawner();
    const terminal: TerminalHost = {
      spawn: spawner.spawn,
      env: { HOME: '/home/ihor' },
      home: '/home/ihor',
      platform: 'linux',
      exists: (path) => path === '/bin/bash',
    };
    startRunner(server, { update: recordingUpdate().update, terminal });
    await server.frames.next('runner.heartbeat');
    const sessionId = newId();
    server.send({ type: 'terminal.open', sessionId, cols: 80, rows: 24 });
    await server.frames.next('terminal.opened');
    server.send({ type: 'runner.update', cmdId: newId() });
    expect((await server.frames.next('runner.update.result')).error).toBe(
      'busy: 1 open terminal; update it once they end',
    );
    server.send({ type: 'runner.update', cmdId: newId(), force: true });
    const output = await server.frames.next('terminal.output');
    expect(Buffer.from(output.data, 'base64').toString()).toContain('the runner is restarting on its update');
    expect(await server.frames.next('terminal.exit')).toMatchObject({ sessionId, error: 'runner_updating' });
    expect((await server.frames.next('runner.update.result')).ok).toBe(true);
  });

  it('says no build and no self-update without them, and answers unsupported', async () => {
    const server = await fakeServer();
    startRunner(server);
    const hello = await server.frames.next('runner.hello');
    expect(hello).not.toHaveProperty('build');
    expect(hello.caps.selfUpdate).toBe(false);
    await server.frames.next('runner.heartbeat');
    server.send({ type: 'runner.update', cmdId: newId() });
    expect(await server.frames.next('runner.update.result')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^unsupported: /),
    });
  });

  it('says a null build when it runs from its sources', async () => {
    const server = await fakeServer();
    startRunner(server, { build: null });
    expect((await server.frames.next('runner.hello')).build).toBeNull();
  });
});
