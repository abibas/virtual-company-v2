import { newId } from '@mwc/shared/ids';
import type { RunnerTools } from '@mwc/shared/runner-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoundTools } from '../../../src/tools/find.ts';
import type { ToolsHost } from '../../../src/tools/host.ts';
import { cleanUpLinks, fakeServer } from '../../fixtures/link.ts';
import { startRunner, stopRunners } from '../../fixtures/runner.ts';
import { FakeSpawn } from '../../fixtures/spawn.ts';

afterEach(async () => {
  await stopRunners();
  await cleanUpLinks();
});

const NPM = '/opt/node/bin/npm';
const AT_START: RunnerTools = {
  claude: '2.1.319 (Claude Code)',
  codex: null,
  git: 'git version 2.39.5',
  gh: null,
  docker: null,
};
const AFTER: RunnerTools = { ...AT_START, codex: 'codex-cli 0.163.0' };

/** A Linux machine whose CLI search finds Codex once it was installed. */
function machine(): ToolsHost {
  let found: FoundTools = { versions: AT_START, clis: {} };
  return {
    find: async () => found,
    npm: () => {
      found = { versions: AFTER, clis: {} };
      return NPM;
    },
    home: '/home/ihor',
    env: { HOME: '/home/ihor', PATH: '/usr/bin' },
  };
}

describe("the runner's tools on the wire", () => {
  it('says its CLIs in its hello, and answers tools.check with runner.caps, then tools.result', async () => {
    const server = await fakeServer();
    startRunner(server, { tools: { host: machine(), found: AT_START } });
    expect((await server.frames.next('runner.hello')).caps.tools).toEqual(AT_START);
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'tools.check', cmdId });
    expect((await server.frames.next('runner.caps')).caps.tools).toEqual(AT_START);
    expect(await server.frames.next('tools.result')).toEqual({
      type: 'tools.result',
      cmdId,
      ok: true,
      tools: AT_START,
    });
  });

  it('installs with npm: its output lines, runner.caps with the new CLI, then tools.result', async () => {
    const server = await fakeServer();
    const spawn = new FakeSpawn().when(NPM, (child) => {
      child.stdout?.write('added 1 package in 3s\n');
      child.exit(0);
    });
    startRunner(server, { spawn, tools: { host: machine(), found: AT_START } });
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'tools.install', cmdId, tool: 'codex', version: '0.163.0' });
    expect(await server.frames.next('tools.output')).toEqual({
      type: 'tools.output',
      cmdId,
      line: 'added 1 package in 3s',
    });
    expect((await server.frames.next('runner.caps')).caps.tools).toEqual(AFTER);
    expect(await server.frames.next('tools.result')).toEqual({
      type: 'tools.result',
      cmdId,
      ok: true,
      tools: AFTER,
    });
  });

  it('without its tools says none and answers unsupported', async () => {
    const server = await fakeServer();
    startRunner(server);
    expect((await server.frames.next('runner.hello')).caps.tools).toBeUndefined();
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'tools.check', cmdId });
    expect(await server.frames.next('tools.result')).toEqual({
      type: 'tools.result',
      cmdId,
      ok: false,
      error: 'unsupported: this runner does not report its tools',
    });
  });
});
