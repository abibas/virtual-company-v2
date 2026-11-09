import { EventEmitter } from 'node:events';
import { newId } from '@mwc/shared/ids';
import type { TunnelSpec, TunnelState } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import type { ProcessCommand } from '../src/driver.ts';
import {
  lastLine,
  retryDelay,
  TUNNEL_KILL_GRACE_MS,
  TUNNEL_RETRY_MAX_MS,
  TUNNEL_STABLE_MS,
  TUNNEL_UP_AFTER_MS,
  type TunnelChild,
  type TunnelDeps,
  type TunnelSpawn,
  Tunnels,
} from '../src/tunnels.ts';
import { type FakeChild, FakeSpawn, memoryLog } from './fixtures/spawn.ts';
import { FakeTime, settle } from './fixtures/time.ts';

const GCLOUD = '/opt/homebrew/bin/gcloud';
const ENV = { PATH: '/opt/homebrew/bin:/usr/bin', HOME: '/Users/ihor' };

const tunnelOf = (instance: string, port = 9950): TunnelSpec => ({
  machineId: newId(),
  target: { provider: 'airia_devbox', ref: { instance, zone: 'europe-west1-b' } },
  remotePort: port,
  localPort: port,
});

/** The command the executor would build: gcloud with the instance and the forward. */
const commandOf = (tunnel: TunnelSpec): ProcessCommand => ({
  command: GCLOUD,
  args: ['compute', 'ssh', tunnel.target.ref.instance, '-R', `${tunnel.remotePort}:${tunnel.localPort}`],
  env: ENV,
});

function world(command: (tunnel: TunnelSpec) => ProcessCommand | undefined = commandOf) {
  const time = new FakeTime();
  const spawn = new FakeSpawn();
  const logs = memoryLog();
  const reports: TunnelState[] = [];
  const deps: TunnelDeps = {
    command,
    spawn: spawn.spawn,
    killGroup: spawn.killGroup,
    clock: time,
    timers: time,
    log: logs.log,
    report: (state) => reports.push(state),
  };
  const tunnels = new Tunnels(deps);
  const children = () => spawn.of(GCLOUD).map((call) => call.child);
  const last = () => children().at(-1) as FakeChild;
  const statesOf = (tunnel: TunnelSpec) =>
    reports.filter((report) => report.machineId === tunnel.machineId).map((report) => report.state);
  return { time, spawn, logs, reports, deps, tunnels, children, last, statesOf };
}

describe('the tunnel rules', () => {
  it('waits 5 s, doubling to 5 minutes', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
  });

  it('reads the last line printed, trimmed and cut to 500 characters', () => {
    expect(lastLine('Connecting…\r\n  ERROR: (gcloud.compute.ssh) exited 255  \n\n')).toBe(
      'ERROR: (gcloud.compute.ssh) exited 255',
    );
    expect(lastLine(`${'x'.repeat(600)}\n`)).toBe('x'.repeat(500));
    expect(lastLine(' \n')).toBeUndefined();
  });
});

describe('the tunnels', () => {
  it('start each wanted tunnel detached with its command, stop the extra ones and leave the same set alone', async () => {
    const w = world();
    const [a, b] = [tunnelOf('dev-a'), tunnelOf('dev-b')];
    w.tunnels.set([a]);
    expect(w.spawn.calls).toEqual([
      {
        file: GCLOUD,
        args: commandOf(a).args,
        options: { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: ENV },
        child: w.last(),
      },
    ]);
    expect(w.reports).toEqual([{ type: 'tunnel.state', machineId: a.machineId, state: 'connecting' }]);
    w.tunnels.set([a, b]);
    w.tunnels.set([{ ...a }, b]);
    expect(w.children()).toHaveLength(2);
    const [first, second] = w.children() as [FakeChild, FakeChild];
    w.tunnels.set([b]);
    expect(w.spawn.groupKills).toEqual([{ pid: first.pid, signal: 'SIGTERM' }]);
    await w.time.advance(TUNNEL_RETRY_MAX_MS);
    expect(first.exited).toBe(true);
    expect(w.children()).toHaveLength(2);
    expect(w.statesOf(a)).toEqual(['connecting']);
    expect(w.tunnels.states()).toEqual([{ type: 'tunnel.state', machineId: b.machineId, state: 'up' }]);
    expect(second.exited).toBe(false);
    expect(w.logs.messages('info')).toContain('stopping a tunnel');
  });

  it('restart one whose ports or target changed once its old process is gone, and wait for a removed one too', async () => {
    const w = world();
    const box = tunnelOf('dev-a');
    w.tunnels.set([box]);
    const old = w.last();
    old.dies = false;
    w.tunnels.set([{ ...box, remotePort: 9963, localPort: 9960 }]);
    expect(w.children()).toHaveLength(1);
    await w.time.advance(TUNNEL_KILL_GRACE_MS);
    expect(old.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(w.children()).toHaveLength(2);
    expect(w.last().pid).not.toBe(old.pid);
    expect(w.spawn.calls[1]?.args.at(-1)).toBe('9963:9960');
    expect(w.logs.messages('info')).toContain('restarting a tunnel for its new target');
    // Removed and wanted again at once: the new process waits for the old one to end.
    const moved = w.last();
    w.tunnels.set([]);
    w.tunnels.set([{ ...box, remotePort: 9963, localPort: 9960 }]);
    expect(w.children()).toHaveLength(2);
    await settle();
    expect(moved.exited).toBe(true);
    expect(w.children()).toHaveLength(3);
  });

  it('stop a process group with SIGTERM, then SIGKILL after 5 s when it is still there', async () => {
    const w = world();
    w.tunnels.set([tunnelOf('dev-a')]);
    const child = w.last();
    child.dies = false;
    w.tunnels.set([]);
    await w.time.advance(TUNNEL_KILL_GRACE_MS - 1);
    expect(w.spawn.groupKills).toEqual([{ pid: child.pid, signal: 'SIGTERM' }]);
    await w.time.advance(1);
    expect(w.spawn.groupKills.map((kill) => kill.signal)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(child.exited).toBe(true);
    expect(w.logs.messages('warn')).toContain('a tunnel did not stop in time; killing it');
    await w.time.advance(TUNNEL_RETRY_MAX_MS);
    expect(w.children()).toHaveLength(1);
  });

  it('are up after 10 s alive, and down with the last line printed when they end', async () => {
    const w = world();
    const box = tunnelOf('dev-a');
    w.tunnels.set([box]);
    await w.time.advance(TUNNEL_UP_AFTER_MS - 1);
    expect(w.statesOf(box)).toEqual(['connecting']);
    await w.time.advance(1);
    expect(w.statesOf(box)).toEqual(['connecting', 'up']);
    const child = w.last();
    child.printErr(
      'Connecting through IAP\nERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].\n',
    );
    child.exit(255);
    await settle();
    const down = 'ERROR: (gcloud.compute.ssh) [/usr/bin/ssh] exited with return code [255].';
    expect(w.reports.at(-1)).toEqual({
      type: 'tunnel.state',
      machineId: box.machineId,
      state: 'down',
      error: down,
    });
    await w.time.advance(retryDelay(0));
    expect(w.children()).toHaveLength(2);
    // Reconnecting says why it dropped; up clears it.
    expect(w.reports.at(-1)).toEqual({
      type: 'tunnel.state',
      machineId: box.machineId,
      state: 'connecting',
      error: down,
    });
    await w.time.advance(TUNNEL_UP_AFTER_MS);
    expect(w.reports.at(-1)).toEqual({ type: 'tunnel.state', machineId: box.machineId, state: 'up' });
  });

  it('say how a silent process ended: its exit code, its signal, or why it could not start', async () => {
    const w = world();
    const box = tunnelOf('dev-a');
    w.tunnels.set([box]);
    w.last().exit(1);
    await settle();
    expect(w.reports.at(-1)?.error).toBe('exited with code 1');
    await w.time.advance(retryDelay(0));
    w.last().exit(null, 'SIGHUP');
    await settle();
    expect(w.reports.at(-1)?.error).toBe('killed by SIGHUP');
    await w.time.advance(retryDelay(1));
    w.last().fail('spawn /opt/homebrew/bin/gcloud ENOENT');
    await settle();
    expect(w.reports.at(-1)?.error).toBe('spawn /opt/homebrew/bin/gcloud ENOENT');
    w.spawn.throwsFor.add(GCLOUD);
    await w.time.advance(retryDelay(2));
    expect(w.reports.at(-1)).toMatchObject({ state: 'down', error: `cannot start ${GCLOUD}` });
    expect(w.logs.messages('warn')).toContain('a tunnel ended; starting it again later');
  });

  it('say only that the tunnel ended when its process gives no reason', async () => {
    const w = world();
    w.tunnels.set([tunnelOf('dev-a')]);
    w.last().fail('');
    await settle();
    expect(w.reports.at(-1)).toMatchObject({ state: 'down', error: 'the tunnel ended' });
  });

  it('end once when a process both fails and closes, and read no output from one without its standard error', async () => {
    const w = world();
    const box = tunnelOf('dev-a');
    w.tunnels.set([box]);
    const child = w.last();
    child.fail('spawn EACCES');
    child.exit(null);
    await settle();
    expect(w.statesOf(box)).toEqual(['connecting', 'down']);
    expect(w.reports.at(-1)?.error).toBe('spawn EACCES');
    // A spawn that gives neither a pid nor a standard error: stopped without a signal, ended by its close alone.
    const bare = Object.assign(new EventEmitter(), { stdout: null, stderr: null, kill: () => true });
    const quiet = world();
    const spawn: TunnelSpawn = () => bare as unknown as TunnelChild;
    const tunnels = new Tunnels({ ...quiet.deps, spawn });
    tunnels.set([box]);
    bare.emit('close', null, null);
    expect(quiet.reports.at(-1)).toMatchObject({ state: 'down', error: 'killed by a signal' });
    await quiet.time.advance(retryDelay(0));
    tunnels.set([]);
    expect(quiet.spawn.groupKills).toEqual([]);
  });

  it('wait longer after each failure in a row, up to 5 minutes, and 5 s again after one stayed up a minute', async () => {
    const w = world();
    w.tunnels.set([tunnelOf('dev-a')]);
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      w.last().exit(255);
      await settle();
      waits.push(w.time.pending[0] as number);
      await w.time.advance(w.time.pending[0] as number);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    await w.time.advance(TUNNEL_STABLE_MS);
    w.last().exit(255);
    await settle();
    expect(w.time.pending).toEqual([5_000]);
  });

  it('report down without starting anything for a machine this runner cannot hold a tunnel to', async () => {
    const w = world(() => undefined);
    const box = tunnelOf('dev-a');
    w.tunnels.set([box]);
    expect(w.spawn.calls).toEqual([]);
    expect(w.reports).toEqual([
      {
        type: 'tunnel.state',
        machineId: box.machineId,
        state: 'down',
        error: 'this runner cannot hold a tunnel to this machine',
      },
    ]);
    await w.time.advance(TUNNEL_RETRY_MAX_MS);
    expect(w.spawn.calls).toEqual([]);
  });

  it('stop every tunnel on close, waiting for them, and start nothing afterwards', async () => {
    const w = world();
    const [a, b] = [tunnelOf('dev-a'), tunnelOf('dev-b')];
    w.tunnels.set([a, b]);
    w.children()[1]?.exit(255);
    await settle();
    expect(w.time.pending).toContain(retryDelay(0));
    await w.tunnels.close();
    expect(w.spawn.groupKills).toEqual([{ pid: w.children()[0]?.pid, signal: 'SIGTERM' }]);
    expect(w.children()[0]?.exited).toBe(true);
    await w.time.advance(TUNNEL_RETRY_MAX_MS);
    w.tunnels.set([a, b, tunnelOf('dev-c')]);
    expect(w.children()).toHaveLength(2);
    expect(w.tunnels.states()).toEqual([]);
  });
});
