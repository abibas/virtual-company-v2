import { companies, machines } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MachineSample } from '@mwc/shared/machines';
import { encodeFrame, RUNNER_CLOSE, RUNNER_PROTOCOL_VERSION } from '@mwc/shared/runner-protocol';
import { LEVEL, TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enroll, machineRow, sampleAt, samplesOf, sessionsOf } from '../../../fixtures/machines/machines.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { rawClient } from '../../../fixtures/platform/realtime.ts';

let w: MachinesWorld;
let company: MembersCompany;
beforeAll(async () => {
  w = await machinesWorld({ minRunnerVersion: '0.4.0' });
  company = await membersCompany(w);
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const NOW = Date.parse(TEST_NOW);
const MINUTE = 60_000;
const said = (msg: string) => w.logs.filter((line) => line.msg === msg);
const row = (machineId: string) => machineRow(w.t.db, machineId);
const HELLO = {
  type: 'runner.hello',
  protocol: 1,
  version: '1.0.0',
  caps: { harnesses: [], slots: 1, hold: 'none', power: [] },
};

describe('a runner says hello', () => {
  it('starts a session and puts the machine online with its versions and slots', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    await w.connect(runnerKey, { version: '0.6.1', caps: { slots: 4 } });
    expect(await row(machineId)).toMatchObject({
      status: 'online',
      lastSeenAt: w.clock(),
      runnerVersion: '0.6.1',
      claudeVersion: '2.1.3 (Claude Code)',
      slots: 4,
      holdUntil: null,
    });
    expect(await sessionsOf(w.t.db, machineId)).toMatchObject([
      {
        connectedAt: w.clock(),
        disconnectedAt: null,
        version: '0.6.1',
        remoteIp: expect.stringMatching(/127\.0\.0\.1/),
      },
    ]);
    expect(said('runner: connected')).toContainEqual(
      expect.objectContaining({ machineId, version: '0.6.1' }),
    );
  });

  it("records Claude Code's version when the hello says it, null included", async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const socket = await rawClient(w.url, { key: runnerKey });
    socket.socket.send(JSON.stringify({ ...HELLO, claudeVersion: null }));
    await eventually('the hello is recorded', async () => (await row(machineId))?.status === 'online');
    expect((await row(machineId))?.claudeVersion).toBeNull();
    socket.socket.close();
    await socket.closed;
  });

  it('closes 4008 when no hello comes in time, and leaves the machine offline', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const socket = await rawClient(w.url, { key: runnerKey });
    socket.socket.send(encodeFrame({ type: 'runner.resync', runs: [] }));
    expect(await socket.closed).toBe(RUNNER_CLOSE.helloTimeout);
    expect(said('runner: ignored a frame outside its accepted hello')).toContainEqual(
      expect.objectContaining({ machineId, type: 'runner.resync', level: LEVEL.debug }),
    );
    expect(await row(machineId)).toMatchObject({ status: 'offline', lastSeenAt: null });
  });

  it('closes 4002 for another protocol, without server.hello', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const socket = await rawClient(w.url, { key: runnerKey });
    socket.socket.send(JSON.stringify({ ...HELLO, protocol: RUNNER_PROTOCOL_VERSION + 1 }));
    expect(await socket.closed).toBe(RUNNER_CLOSE.unsupportedProtocol);
    expect(socket.received).toEqual([]);
    expect((await row(machineId))?.status).toBe('offline');
  });

  it('answers a runner too old with server.hello, records its version and closes 4003; it never comes online', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey, { version: '0.3.9' });
    expect(runner.frames.of('server.hello')[0]).toMatchObject({ minRunnerVersion: '0.4.0', machineId });
    expect((await runner.closed()).code).toBe(RUNNER_CLOSE.runnerTooOld);
    await w.hub.idle();
    expect(await row(machineId)).toMatchObject({
      status: 'offline',
      runnerVersion: '0.3.9',
      lastSeenAt: null,
    });
    expect(await sessionsOf(w.t.db, machineId)).toEqual([]);
  });

  it('lets a newer connection take over (the old one closed 4004): the machine stays online', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const first = await w.connect(runnerKey);
    w.clock.advance(MINUTE);
    const second = await w.connect(runnerKey);
    expect((await first.closed()).code).toBe(RUNNER_CLOSE.replaced);
    await w.hub.idle();
    expect((await row(machineId))?.status).toBe('online');
    const sessions = await sessionsOf(w.t.db, machineId);
    expect(sessions.map((session) => [session.connectedAt, session.disconnectedAt])).toEqual([
      [new Date(NOW), new Date(NOW)],
      [w.clock(), null],
    ]);
    expect(w.hub.isOnline(machineId)).toBe(true);
    await second.disconnect();
    await eventually('offline', async () => (await row(machineId))?.status === 'offline');
  });

  it("ends the session it replaces at the machine's last sign of life", async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    w.clock.advance(MINUTE);
    runner.heartbeat();
    await eventually(
      'the heartbeat',
      async () => (await row(machineId))?.lastSeenAt?.getTime() === NOW + MINUTE,
    );
    w.clock.advance(5 * MINUTE);
    await w.connect(runnerKey);
    await w.hub.idle();
    const [replaced] = await sessionsOf(w.t.db, machineId);
    expect(replaced?.disconnectedAt).toEqual(new Date(NOW + MINUTE));
  });
});

describe('what a connected runner says', () => {
  it('moves last_seen_at on each heartbeat and keeps one sample per minute (the last)', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    const beat = async (advanceMs: number, sample?: MachineSample) => {
      w.clock.advance(advanceMs);
      runner.heartbeat(sample === undefined ? {} : { sample });
      const at = w.clock().getTime();
      await eventually('the heartbeat', async () => (await row(machineId))?.lastSeenAt?.getTime() === at);
      await w.hub.idle();
    };
    await beat(20_000, sampleAt(NOW + 5_000, { cpuPct: 10 }));
    await beat(20_000, sampleAt(NOW + 40_000, { cpuPct: 30 }));
    await beat(40_000, sampleAt(NOW + MINUTE + 5_000, { cpuPct: 50 }));
    // From a clock running ahead: kept under the server's minute, replacing that minute's sample.
    await beat(20_000, sampleAt(NOW + 10 * MINUTE, { cpuPct: 70 }));
    await beat(20_000);
    const samples = await samplesOf(w.t.db, machineId);
    expect(samples.map((sample) => [sample.at.getTime() - NOW, sample.cpuPct])).toEqual([
      [0, 30],
      [MINUTE, 70],
    ]);
    expect(samples[1]).toMatchObject({ load1: 0.8, cpus: 8, diskTotal: 1_000_000_000_000, liveRuns: 0 });
  });

  it('records the hold it reports, and its release', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey, { hold: { until: NOW + 20 * MINUTE, source: 'server' } });
    await eventually('the first hold', async () => (await row(machineId))?.holdSource === 'server');
    expect((await row(machineId))?.holdUntil).toEqual(new Date(NOW + 20 * MINUTE));
    runner.send({ type: 'hold.state', until: null, source: 'live_runs' });
    await eventually('the release', async () => (await row(machineId))?.holdSource === 'live_runs');
    expect((await row(machineId))?.holdUntil).toBeNull();
  });

  it('comes back online on its next heartbeat after the sweep took it offline', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    await rawDb(w.t.db).update(machines).set({ status: 'offline' }).where(eq(machines.id, machineId));
    w.clock.advance(MINUTE);
    runner.heartbeat();
    await eventually('online again', async () => (await row(machineId))?.status === 'online');
    expect((await row(machineId))?.lastSeenAt).toEqual(w.clock());
  });

  it('never ends a session before it began (a clock moved back)', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    w.clock.advance(-MINUTE);
    await runner.disconnect();
    await eventually('offline', async () => (await row(machineId))?.status === 'offline');
    expect((await sessionsOf(w.t.db, machineId))[0]?.disconnectedAt).toEqual(new Date(NOW));
  });

  it('takes the machine offline when it disconnects, ending its session', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    w.clock.advance(MINUTE);
    await runner.disconnect();
    await eventually('offline', async () => (await row(machineId))?.status === 'offline');
    expect((await sessionsOf(w.t.db, machineId))[0]?.disconnectedAt).toEqual(w.clock());
    expect(said('runner: disconnected')).toContainEqual(expect.objectContaining({ machineId, code: 1000 }));
  });

  it('ignores unknown frames, logs invalid ones, and leaves frames of runs (S5) and stray replies', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey);
    const socket = await rawClient(w.url, { key: runnerKey });
    socket.socket.send(JSON.stringify(HELLO));
    await eventually(
      'the raw runner took over',
      async () => (await runner.closed()).code === RUNNER_CLOSE.replaced,
    );
    socket.socket.send(JSON.stringify({ type: 'runner.dance', moves: 3 }));
    socket.socket.send('{"type":"runner.heartbeat"}');
    socket.socket.send(JSON.stringify(HELLO));
    socket.socket.send(
      JSON.stringify({ type: 'cmd.ack', cmdId: '019a5b2e-0000-7000-8000-00000000c0de', ok: true }),
    );
    socket.socket.send(
      JSON.stringify({ type: 'job.decline', id: machineId, runId: machineId, reason: 'no slot' }),
    );
    await eventually('every frame was read', () =>
      said('runner: accepted a frame with nothing to do before runs (S5)').some(
        (line) => line.type === 'job.decline',
      ),
    );
    expect(said('runner: ignored an unknown frame')).toContainEqual(
      expect.objectContaining({ type: 'runner.dance', level: LEVEL.debug }),
    );
    expect(said('runner: ignored an invalid frame')).toContainEqual(
      expect.objectContaining({
        machineId,
        code: 'invalid',
        frameType: 'runner.heartbeat',
        level: LEVEL.warn,
      }),
    );
    expect(said('runner: ignored a second runner.hello')).toHaveLength(1);
    expect(said('runner: a reply nobody waits for')).toHaveLength(1);
    expect(socket.socket.readyState).toBe(socket.socket.OPEN);
    socket.socket.close();
    await socket.closed;
  });

  it('closes 1011 when the connection cannot be recorded (its company went away)', async () => {
    const gone = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, gone);
    const socket = await rawClient(w.url, { key: runnerKey });
    await rawDb(w.t.db).update(companies).set({ status: 'deleted' }).where(eq(companies.id, gone.companyId));
    socket.socket.send(JSON.stringify(HELLO));
    expect(await socket.closed).toBe(1011);
    expect(said('runner: could not record what the runner said')).toContainEqual(
      expect.objectContaining({ machineId, level: LEVEL.error }),
    );
  });
});
