import { newId } from '@mwc/shared/ids';
import { type PowerCommand, RUNNER_CLOSE } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { FAKE_CLAUDE_VERSION } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HubError } from '../../../../../src/modules/machines/index.ts';
import { enroll, machineRow } from '../../../../fixtures/machines/machines.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { type MembersCompany, membersCompany } from '../../../../fixtures/members/members.ts';
import { rawClient } from '../../../../fixtures/platform/realtime.ts';

let w: MachinesWorld;
let company: MembersCompany;
beforeAll(async () => {
  w = await machinesWorld();
  company = await membersCompany(w);
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const powerStatus = (): PowerCommand => ({
  type: 'power.command',
  cmdId: newId(),
  target: { provider: 'airia_devbox', ref: { instance: 'dev-ihorherasko', zone: 'europe-west1-b' } },
  action: 'status',
});

/** What a request rejected with. */
async function failure(promise: Promise<unknown>): Promise<HubError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof HubError)) throw new Error(`Expected a HubError, got ${String(error)}`);
  return error;
}

describe('which runners the hub has', () => {
  it('knows a runner from its server.hello to its close: version, build time, build, caps and since when', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    expect([w.hub.isOnline(machineId), w.hub.connected(machineId)]).toEqual([false, undefined]);
    const runner = await w.connect(runnerKey, {
      version: '0.7.0',
      builtAt: '2026-11-09T16:40:00.000Z',
      build: 'ab'.repeat(32),
      caps: { power: ['airia_devbox'], hold: 'caffeinate', selfUpdate: true },
    });
    expect(w.hub.isOnline(machineId)).toBe(true);
    expect(w.hub.connected(machineId)).toEqual({
      companyId: company.companyId,
      machineId,
      version: '0.7.0',
      builtAt: '2026-11-09T16:40:00.000Z',
      build: 'ab'.repeat(32),
      caps: {
        harnesses: { claude_code: FAKE_CLAUDE_VERSION, codex: null },
        slots: 8,
        hold: 'caffeinate',
        power: ['airia_devbox'],
        terminal: false,
        selfUpdate: true,
        folders: false,
        mkdirp: false,
        forks: false,
        reattach: false,
        agentTools: false,
        serverTools: false,
      },
      connectedAt: w.clock(),
    });
    await runner.disconnect();
    await eventually('gone', () => !w.hub.isOnline(machineId));
    expect(w.hub.connected(machineId)).toBeUndefined();
  });

  it('tells each connect listener about a runner once it is ready, logs one that throws, and stops on unsubscribe', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const seen: string[] = [];
    const off = w.hub.onConnect((runner) => seen.push(`${runner.machineId} ${runner.version}`));
    const offBoom = w.hub.onConnect(() => {
      throw new Error('boom');
    });
    const runner = await w.connect(runnerKey, { version: '0.7.0' });
    expect(seen).toEqual([`${machineId} 0.7.0`]);
    expect(w.logs).toContainEqual(
      expect.objectContaining({ msg: 'runner hub: a connect listener failed', machineId }),
    );
    off();
    offBoom();
    await runner.reconnect();
    expect(seen).toHaveLength(1);
    expect(w.hub.isOnline(machineId)).toBe(true);
  });
});

describe('send and request', () => {
  it('sends a frame to a connected runner, and says when there is none', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    const hold = { type: 'machine.hold', cmdId: newId(), until: Date.parse(TEST_NOW) + 60_000 } as const;
    expect(w.hub.send(machineId, hold)).toBe(false);
    const runner = await w.connect(runnerKey);
    expect(w.hub.send(machineId, hold)).toBe(true);
    // The power code sends it a hold of its own on connect (none here), before or after this one.
    expect(await runner.frames.next('machine.hold', (frame) => frame.cmdId === hold.cmdId)).toEqual(hold);
    expect(await runner.frames.next('machine.hold')).toMatchObject({ until: null });
  });

  it('matches power.result to its power.command, and cmd.ack to any other command', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    await w.connect(runnerKey, {
      respond: (frame) =>
        frame.type === 'power.command'
          ? [
              {
                type: 'power.result',
                cmdId: frame.cmdId,
                ok: true,
                status: 'running',
                metadata: { tz: 'Europe/Kyiv' },
              },
            ]
          : 'cmdId' in frame
            ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: false, error: 'no caffeinate here' }]
            : [],
    });
    const command = powerStatus();
    expect(await w.hub.request(machineId, command)).toEqual({
      type: 'power.result',
      cmdId: command.cmdId,
      ok: true,
      status: 'running',
      metadata: { tz: 'Europe/Kyiv' },
    });
    const drain = { type: 'runner.drain', cmdId: newId() } as const;
    expect(await w.hub.request(machineId, drain)).toEqual({
      type: 'cmd.ack',
      cmdId: drain.cmdId,
      ok: false,
      error: 'no caffeinate here',
    });
  });

  it('rejects a request: offline, unanswered in time, or the runner gone before it answered', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    expect(await failure(w.hub.request(machineId, powerStatus()))).toMatchObject({
      code: 'offline',
      machineId,
    });
    const runner = await w.connect(runnerKey, { respond: () => [] });
    expect(await failure(w.hub.request(machineId, powerStatus(), { timeoutMs: 50 }))).toMatchObject({
      code: 'timeout',
      message: expect.stringContaining('power.command'),
    });
    // The hub's own default timeout (400 ms in these tests) applies when none is given.
    expect((await failure(w.hub.request(machineId, powerStatus()))).code).toBe('timeout');
    // Caught at once: the rejection comes while the runner is still disconnecting.
    const pending = failure(w.hub.request(machineId, powerStatus(), { timeoutMs: 5_000 }));
    await eventually('the third command arrived', () => runner.frames.of('power.command').length === 3);
    await runner.disconnect();
    expect((await pending).code).toBe('disconnected');
  });
});

describe('disconnect and close', () => {
  it('closes every socket of a machine with a code, even one still before its hello', async () => {
    const { machineId, runnerKey } = await enroll(w, company);
    expect(w.hub.disconnect(machineId, RUNNER_CLOSE.unauthorized, 'gone')).toBe(false);
    const runner = await w.connect(runnerKey);
    const early = await rawClient(w.url, { key: runnerKey });
    expect(w.hub.disconnect(machineId, RUNNER_CLOSE.unauthorized, 'gone')).toBe(true);
    expect((await runner.closed()).code).toBe(RUNNER_CLOSE.unauthorized);
    expect(await early.closed).toBe(RUNNER_CLOSE.unauthorized);
  });

  it("on the server's shutdown: says it is going away (1001), cuts a socket that does not answer, and refuses new ones", async () => {
    const own = await machinesWorld({ closeTimeoutMs: 100 });
    const ours = await membersCompany(own);
    const polite = await enroll(own, ours);
    const deaf = await enroll(own, ours);
    const runner = await own.connect(polite.runnerKey);
    const silent = await rawClient(own.url, { key: deaf.runnerKey });
    // It stops reading, so it never answers the close handshake: the hub cuts it after its close timeout.
    (silent.socket as unknown as { _socket: { pause(): void } })._socket.pause();
    await own.hub.close();
    expect((await runner.closed()).code).toBe(1001);
    expect((await machineRow(own.t.db, polite.machineId))?.status).toBe('offline');
    await expect(own.connect(polite.runnerKey)).rejects.toThrow(/1001/);
    await own.close();
  });
});
