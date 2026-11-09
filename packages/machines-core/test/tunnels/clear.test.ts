import { newId } from '@mwc/shared/ids';
import type { TunnelSpec, TunnelState } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import type { ProcessCommand } from '../../src/driver.ts';
import { clearPort } from '../../src/tunnels/clear.ts';
import {
  forwardFailure,
  retryDelay,
  TUNNEL_CLEAR_EVERY_MS,
  TUNNEL_CLEAR_RETRY_MS,
  TUNNEL_CLEAR_TIMEOUT_MS,
  TUNNEL_KILL_GRACE_MS,
  type TunnelDeps,
  type TunnelSpawn,
  Tunnels,
} from '../../src/tunnels.ts';
import { type FakeChild, FakeSpawn, memoryLog } from '../fixtures/spawn.ts';
import { FakeTime, settle } from '../fixtures/time.ts';

const GCLOUD = '/opt/homebrew/bin/gcloud';
const CLEAR = '/opt/homebrew/bin/gcloud-clear';
const ENV = { PATH: '/opt/homebrew/bin:/usr/bin' };
const FAILED = 'Error: remote port forwarding failed for listen port 9950';
const GENERIC = 'ERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].';
const STDERR = `Connecting through IAP\nWarning: Permanently added 'compute.1' to known hosts.\n${FAILED}\n${GENERIC}\n`;
const NOTE = "(clearing a stale holder of the box's port, then retrying)";

const box: TunnelSpec = {
  machineId: newId(),
  target: { provider: 'airia_devbox', ref: { instance: 'dev-a', zone: 'europe-west1-b' } },
  remotePort: 9950,
  localPort: 9950,
};

const commandOf = (tunnel: TunnelSpec): ProcessCommand => ({
  command: GCLOUD,
  args: ['compute', 'ssh', tunnel.target.ref.instance, '-R', `${tunnel.remotePort}`],
  env: ENV,
});
const clearOf = (tunnel: TunnelSpec): ProcessCommand => ({
  command: CLEAR,
  args: ['compute', 'ssh', tunnel.target.ref.instance, '--command', `fuser -k ${tunnel.remotePort}`],
});

function world(clear: TunnelDeps['clearPortCommand'] | 'none' = clearOf) {
  const clearPortCommand = clear === 'none' ? undefined : clear;
  const time = new FakeTime();
  const spawn = new FakeSpawn();
  const logs = memoryLog();
  const reports: TunnelState[] = [];
  const deps: TunnelDeps = {
    command: commandOf,
    clearPortCommand,
    spawn: spawn.spawn,
    killGroup: spawn.killGroup,
    clock: time,
    timers: time,
    log: logs.log,
    report: (state) => reports.push(state),
  };
  const tunnels = new Tunnels(deps);
  const tries = () => spawn.of(GCLOUD).map((call) => call.child);
  const clears = () => spawn.of(CLEAR);
  const last = () => tries().at(-1) as FakeChild;
  /** The current try fails as a taken port makes it fail. */
  const forwardFails = async () => {
    last().printErr(STDERR);
    last().exit(255);
    await settle();
  };
  return { time, spawn, logs, reports, tunnels, tries, clears, last, forwardFails };
}

describe('forwardFailure', () => {
  it("finds ssh's forward failure among many lines, trimmed and cut to 500 characters, and nothing else", () => {
    expect(forwardFailure(STDERR)).toBe(FAILED);
    expect(
      forwardFailure(`  Warning: remote port forwarding failed for listen port 9963 \r\n${GENERIC}`),
    ).toBe('Warning: remote port forwarding failed for listen port 9963');
    expect(forwardFailure(`remote port forwarding failed ${'x'.repeat(600)}`)).toHaveLength(500);
    expect(forwardFailure(`Connecting\n${GENERIC}\n`)).toBeUndefined();
  });
});

describe("the tunnels: a stale holder of the machine's port", () => {
  it('show the forward failure, clear the port once with the driver command, and try again after 2 s', async () => {
    const w = world();
    w.tunnels.set([box]);
    await w.forwardFails();
    expect(w.reports.at(-1)).toEqual({
      type: 'tunnel.state',
      machineId: box.machineId,
      state: 'down',
      error: `${FAILED} ${NOTE}`,
    });
    expect(w.clears()).toEqual([
      {
        file: CLEAR,
        args: clearOf(box).args,
        options: { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
        child: w.clears()[0]?.child,
      },
    ]);
    expect(w.logs.messages('warn')).toContain("a tunnel's port on the machine is taken; clearing it");
    expect(w.time.pending).toEqual([TUNNEL_CLEAR_TIMEOUT_MS]);
    w.clears()[0]?.child.printErr('fuser: done\n');
    w.clears()[0]?.child.exit(0);
    await settle();
    expect(w.logs.messages('info')).toContain("cleared a stale holder of the box's port");
    expect(w.time.pending).toEqual([TUNNEL_CLEAR_RETRY_MS]);
    await w.time.advance(TUNNEL_CLEAR_RETRY_MS);
    expect(w.tries()).toHaveLength(2);
    expect(w.reports.at(-1)).toMatchObject({ state: 'connecting', error: `${FAILED} ${NOTE}` });
  });

  it('fall back to the backoff when the port is still taken, and clear it again only 5 minutes later', async () => {
    const w = world();
    w.tunnels.set([box]);
    await w.forwardFails();
    w.clears()[0]?.child.exit(1);
    await settle();
    await w.time.advance(TUNNEL_CLEAR_RETRY_MS);
    await w.forwardFails();
    expect(w.clears()).toHaveLength(1);
    expect(w.reports.at(-1)).toMatchObject({ state: 'down', error: FAILED });
    expect(w.time.pending).toEqual([retryDelay(1)]);
    // Still within 5 minutes of the clearing: the backoff again.
    await w.time.advance(retryDelay(1));
    await w.forwardFails();
    expect(w.clears()).toHaveLength(1);
    expect(w.time.pending).toEqual([retryDelay(2)]);
    await w.time.advance(TUNNEL_CLEAR_EVERY_MS);
    await w.forwardFails();
    expect(w.clears()).toHaveLength(2);
  });

  it('keep the normal backoff and the last line for any other failure', async () => {
    const w = world();
    w.tunnels.set([box]);
    w.last().printErr(`Connecting through IAP\n${GENERIC}\n`);
    w.last().exit(255);
    await settle();
    expect(w.clears()).toEqual([]);
    expect(w.reports.at(-1)).toMatchObject({ state: 'down', error: GENERIC });
    expect(w.time.pending).toEqual([retryDelay(0)]);
  });

  it('behave as before without a clearing command (none from the driver, or none for this machine)', async () => {
    for (const clear of ['none', () => undefined] as const) {
      const w = world(clear);
      w.tunnels.set([box]);
      await w.forwardFails();
      expect(w.spawn.calls).toHaveLength(1);
      expect(w.reports.at(-1)).toMatchObject({ state: 'down', error: FAILED });
      expect(w.time.pending).toEqual([retryDelay(0)]);
    }
  });

  it('give the clearing a minute, and try again after it even when it could not start', async () => {
    const w = world();
    w.tunnels.set([box]);
    await w.forwardFails();
    const clearing = w.clears()[0]?.child as FakeChild;
    clearing.dies = false;
    await w.time.advance(TUNNEL_CLEAR_TIMEOUT_MS);
    expect(clearing.signals).toEqual(['SIGKILL']);
    await w.time.advance(TUNNEL_CLEAR_RETRY_MS);
    expect(w.tries()).toHaveLength(2);
    const broken = world();
    broken.spawn.throwsFor.add(CLEAR);
    broken.tunnels.set([box]);
    await broken.forwardFails();
    expect(broken.time.pending).toEqual([TUNNEL_CLEAR_RETRY_MS]);
    await broken.time.advance(TUNNEL_CLEAR_RETRY_MS);
    expect(broken.tries()).toHaveLength(2);
    await broken.tunnels.close();
  });

  it('stop a running clearing with the tunnel, and start its next tunnel only once the clearing is gone', async () => {
    const w = world();
    w.tunnels.set([box]);
    await w.forwardFails();
    const clearing = w.clears()[0]?.child as FakeChild;
    clearing.dies = false;
    w.tunnels.set([]);
    w.tunnels.set([box]);
    expect(clearing.signals).toEqual(['SIGTERM']);
    expect(w.tries()).toHaveLength(1);
    await w.time.advance(TUNNEL_KILL_GRACE_MS);
    expect(clearing.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(w.tries()).toHaveLength(2);
    expect(w.logs.messages('info')).not.toContain("cleared a stale holder of the box's port");
    // A clearing that dies on SIGTERM ends at once, and close waits for it.
    await w.forwardFails();
    const second = w.clears()[1]?.child as FakeChild;
    await w.tunnels.close();
    expect(second.signals).toEqual(['SIGTERM']);
    expect(second.exited).toBe(true);
    expect(w.time.pending).toEqual([]);
  });
});

describe('clearPort', () => {
  it('stops a clearing without a pid at once, and stopping a finished or unstarted one does nothing', async () => {
    const time = new FakeTime();
    const spawn = new FakeSpawn();
    let done = 0;
    const deps = { spawn: spawn.spawn, killGroup: spawn.killGroup, timers: time };
    const noPid: TunnelSpawn = (...args) => Object.assign(spawn.spawn(...args), { pid: undefined });
    const bare = clearPort({ ...deps, spawn: noPid }, clearOf(box), () => done++);
    bare.stop();
    await bare.ended;
    const finished = clearPort(deps, clearOf(box), () => done++);
    spawn.calls.at(-1)?.child.fail();
    await finished.ended;
    finished.stop();
    expect(done).toBe(1);
    // One that cannot start is done at once, with nothing to stop; the environment goes to the process.
    spawn.throwsFor.add(CLEAR);
    const unstarted = clearPort(deps, clearOf(box), () => done++);
    unstarted.stop();
    await unstarted.ended;
    expect(done).toBe(2);
    clearPort(deps, { ...commandOf(box), env: ENV }, () => done++);
    expect(spawn.calls.at(-1)?.options.env).toBe(ENV);
    expect(spawn.groupKills).toEqual([]);
  });
});
