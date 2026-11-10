import { newId } from '@mwc/shared/ids';
import type { RunnerFrame, RunnerTools, ServerFrame } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MachineView } from '../../../../../src/modules/machines/schemas.ts';
import { RESTART_WAIT_MS } from '../../../../../src/modules/machines/service/jobs.ts';
import type { TerminalSink } from '../../../../../src/modules/machines/service/runner/hub.ts';
import { enroll, MAC, machinesPath } from '../../../../fixtures/machines/machines.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../../../../fixtures/members/members.ts';

/** One maintenance job at a time per machine, through the routes: installs and runner updates lock each other out. */

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const TOOLS: RunnerTools = { claude: null, codex: null, git: null, gh: null, docker: null };
const BUILD = 'cd'.repeat(32);
const INSTALLING = 'Codex 0.163.0 is being installed: wait for it to finish';
const UPDATING = 'The runner is updating: wait for it to restart';

/** A runner that holds `tools.install` and `runner.update` until the test answers them, and acks the rest. */
const holding = (frame: ServerFrame): RunnerFrame[] =>
  frame.type === 'tools.install' || frame.type === 'runner.update' || !('cmdId' in frame)
    ? []
    : frame.type === 'tools.check'
      ? [{ type: 'tools.result', cmdId: frame.cmdId, ok: true, tools: TOOLS }]
      : [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }];

const CAPS = { selfUpdate: true, terminal: true, tools: TOOLS };

/** A company with This Mac, its runner connected: it updates itself, has the tools and a terminal. */
async function machine() {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company, MAC);
  const runner = await w.connect(runnerKey, { build: 'ab'.repeat(32), caps: CAPS, respond: holding });
  return { company, machineId, runnerKey, runner, api: api(company, machineId) };
}

function api(company: MembersCompany, machineId: string) {
  const call = as(w, company.owner);
  const path = (rest: string) => machinesPath(company, `/${machineId}${rest}`);
  return {
    install: (tool: string) => call('POST', path('/tools/install'), { tool }),
    check: () => call('POST', path('/tools/check')),
    update: (body?: unknown) => call('POST', path('/runner-update'), body),
    runner: async () => ((await call('GET', path(''))).body as MachineView).runner,
  };
}

const busy = (message: string) => ({ status: 409, body: { error: { code: 'machine_busy', message } } });

/** Starts an update the runner holds; resolves with its pending answer once the runner got `runner.update`. */
async function holdUpdate(m: Awaited<ReturnType<typeof machine>>, body?: unknown) {
  const pending = m.api.update(body);
  const frame = await m.runner.frames.next('runner.update');
  return { pending, frame };
}

/** The runner's answer to the update: the new build in place. */
const updated = (runner: FakeRunner, cmdId: string) =>
  runner.send({ type: 'runner.update.result', cmdId, ok: true, build: BUILD });

describe('an install and a runner update on one machine', () => {
  it('refuses the update while the install runs, shows the job, and takes it once the install ended', async () => {
    const m = await machine();
    const started = await m.api.install('codex');
    const { installId } = started.body as { installId: string };
    expect(await m.api.update()).toMatchObject(busy(INSTALLING));
    expect(await m.api.install('claude')).toMatchObject(busy(INSTALLING));
    expect(m.runner.frames.of('runner.update')).toEqual([]);
    expect((await m.api.runner()).job).toEqual({
      kind: 'tool_install',
      tool: 'codex',
      version: '0.163.0',
      startedAt: TEST_NOW,
    });
    expect((await m.api.check()).status).toBe(200);
    m.runner.send({
      type: 'tools.result',
      cmdId: installId,
      ok: false,
      error: 'failed: npm exited with code 1',
    });
    await eventually('the install ended', async () => (await m.api.runner()).job === null);
    const { pending, frame } = await holdUpdate(m);
    updated(m.runner, frame.cmdId);
    expect((await pending).status).toBe(202);
  });

  it('releases an install when its runner goes away', async () => {
    const m = await machine();
    expect((await m.api.install('codex')).status).toBe(202);
    await m.runner.disconnect();
    await eventually('the install ended', async () => (await m.api.runner()).job === null);
    const again = await w.connect(m.runnerKey, { caps: CAPS, respond: holding });
    expect((await m.api.install('codex')).status).toBe(202);
    await again.frames.next('tools.install');
  });

  it('refuses installs and checks while the runner updates, until it reconnects on the new build', async () => {
    const m = await machine();
    const { pending, frame } = await holdUpdate(m);
    expect(await m.api.install('codex')).toMatchObject(busy(UPDATING));
    expect(await m.api.check()).toMatchObject(busy(UPDATING));
    expect(await m.api.update()).toMatchObject(busy(UPDATING));
    updated(m.runner, frame.cmdId);
    expect((await pending).status).toBe(202);
    expect((await m.api.runner()).job).toMatchObject({ kind: 'runner_update', path: 'self_update' });
    expect(await m.api.install('codex')).toMatchObject(busy(UPDATING));
    await m.runner.disconnect();
    expect(await m.api.check()).toMatchObject(busy(UPDATING));
    await w.connect(m.runnerKey, { build: BUILD, caps: CAPS, respond: holding });
    expect((await m.api.runner()).job).toBeNull();
    expect((await m.api.check()).status).toBe(200);
  });

  it('gives up waiting for the restart after its time', async () => {
    const m = await machine();
    const { pending, frame } = await holdUpdate(m);
    updated(m.runner, frame.cmdId);
    expect((await pending).status).toBe(202);
    w.clock.advance(RESTART_WAIT_MS - 1);
    expect(await m.api.check()).toMatchObject(busy(UPDATING));
    w.clock.advance(1);
    expect((await m.api.check()).status).toBe(200);
  });

  it('releases an update the runner refused or failed at once', async () => {
    const m = await machine();
    for (const error of ['busy: 1 live run; update it once they end', 'download_failed: no route']) {
      const { pending, frame } = await holdUpdate(m);
      m.runner.send({ type: 'runner.update.result', cmdId: frame.cmdId, ok: false, error });
      expect((await pending).status).not.toBe(202);
      expect((await m.api.runner()).job).toBeNull();
    }
  });
});

describe('a runner update while the machine has live work', () => {
  /** Opens a terminal on the machine through the hub, as the terminal relay does. */
  const openTerminal = (machineId: string) => {
    const sink: TerminalSink = { opened: () => {}, output: () => {}, exit: () => {} };
    const channel = w.hub.terminal(machineId, { sessionId: newId(), cols: 80, rows: 24 }, sink);
    if (channel === undefined) throw new Error('no terminal');
    return channel;
  };

  it('is refused while a terminal is open, naming it, shown in the live counts; force goes ahead', async () => {
    const m = await machine();
    const terminal = openTerminal(m.machineId);
    expect((await m.api.runner()).live).toEqual({ turns: 0, terminals: 1 });
    expect(await m.api.update()).toMatchObject(
      busy('1 terminal is running on it: update the runner once it ends'),
    );
    expect(await m.api.update({ force: false })).toMatchObject({ status: 409 });
    expect((await m.api.runner()).job).toBeNull();
    const { pending, frame } = await holdUpdate(m, { force: true });
    expect(frame.force).toBe(true);
    updated(m.runner, frame.cmdId);
    expect((await pending).status).toBe(202);
    terminal.close();
    expect((await m.api.runner()).live).toEqual({ turns: 0, terminals: 0 });
  });

  it('sends no force to the runner unless asked', async () => {
    const m = await machine();
    const { pending, frame } = await holdUpdate(m);
    expect(frame).not.toHaveProperty('force');
    updated(m.runner, frame.cmdId);
    await pending;
  });

  it('refuses a force that is not a boolean', async () => {
    const m = await machine();
    expect((await m.api.update({ force: 'yes' })).status).toBe(400);
  });
});
