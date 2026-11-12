import { newId } from '@mwc/shared/ids';
import type { TunnelSpec, TunnelState } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import type { ProcessCommand } from '../../src/driver.ts';
import { clearingNote, type EndedTunnel, recovery } from '../../src/tunnels/recover.ts';
import {
  retryDelay,
  retryDelayFor,
  TUNNEL_CLEAR_COOLDOWN_MS,
  TUNNEL_CLEAR_EVERY_MS,
  TUNNEL_CLEAR_RETRY_MS,
  TUNNEL_CLEAR_TIMEOUT_MS,
  TUNNEL_RETRY_RUNNING_MAX_MS,
  TUNNEL_UP_AFTER_MS,
  type TunnelDeps,
  Tunnels,
} from '../../src/tunnels.ts';
import { type FakeChild, FakeSpawn, memoryLog } from '../fixtures/spawn.ts';
import { FakeTime, settle } from '../fixtures/time.ts';

/**
 * How a tunnel comes back (2026-11-12, after a network blip kept the devbox's tunnel down for 8 minutes): the pure rule
 * (`recovery`), and the supervisor following it for a box that reads running: the port cleared after an up tunnel ends,
 * before every try after a forward failure at most once in 20 s, the backoff capped at 30 s, and a waiting tunnel
 * started at once when its box turns running.
 */

const GCLOUD = '/opt/homebrew/bin/gcloud';
const CLEAR = '/opt/homebrew/bin/gcloud-clear';
const FAILED = 'Error: remote port forwarding failed for listen port 9950';
const DEAD = 'Timeout, server 127.0.0.1 not responding.';

const box: TunnelSpec = {
  machineId: newId(),
  target: { provider: 'airia_devbox', ref: { instance: 'dev-a', zone: 'europe-west1-b' } },
  remotePort: 9950,
  localPort: 9950,
};
const running: TunnelSpec = { ...box, running: true };

const commandOf = (tunnel: TunnelSpec): ProcessCommand => ({
  command: GCLOUD,
  args: ['compute', 'ssh', tunnel.target.ref.instance, '-R', `${tunnel.remotePort}`],
});
const clearOf = (tunnel: TunnelSpec): ProcessCommand => ({
  command: CLEAR,
  args: ['compute', 'ssh', tunnel.target.ref.instance, '--command', `fuser -k ${tunnel.remotePort}`],
});

function world(clears = true) {
  const time = new FakeTime();
  const spawn = new FakeSpawn();
  const logs = memoryLog();
  const reports: TunnelState[] = [];
  const deps: TunnelDeps = {
    command: commandOf,
    clearPortCommand: clears ? clearOf : undefined,
    spawn: spawn.spawn,
    killGroup: spawn.killGroup,
    clock: time,
    timers: time,
    log: logs.log,
    report: (state) => reports.push(state),
  };
  const tunnels = new Tunnels(deps);
  const tries = () => spawn.of(GCLOUD).map((call) => call.child);
  const clearings = () => spawn.of(CLEAR).map((call) => call.child);
  const last = () => tries().at(-1) as FakeChild;
  /** The current try ends, printing `line`. */
  const ends = async (line: string) => {
    last().printErr(`Connecting through IAP\n${line}\n`);
    last().exit(255);
    await settle();
  };
  /** The latest clearing finishes. */
  const cleared = async () => {
    clearings().at(-1)?.exit(0);
    await settle();
  };
  return { time, spawn, logs, reports, tunnels, tries, clearings, last, ends, cleared };
}

describe('the recovery rule', () => {
  const ended = (fields: Partial<EndedTunnel>): EndedTunnel => ({
    running: false,
    wasUp: false,
    forward: false,
    canClear: true,
    clearedAt: undefined,
    failures: 0,
    now: 10 * 60_000,
    ...fields,
  });

  it('caps the backoff at 30 s while the box reads running, and keeps 5 minutes otherwise', () => {
    expect([0, 1, 2, 3, 4, 9].map((failures) => retryDelayFor(failures, true))).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
    expect([0, 3, 9].map((failures) => retryDelayFor(failures, false))).toEqual([0, 3, 9].map(retryDelay));
    expect(recovery(ended({ failures: 6, running: true }))).toEqual({
      clear: false,
      after: TUNNEL_RETRY_RUNNING_MAX_MS,
    });
    expect(recovery(ended({ failures: 6 }))).toEqual({ clear: false, after: retryDelay(6) });
  });

  it('clears after a forward failure or the end of an up tunnel, never for another failure or without a clearing', () => {
    expect(recovery(ended({ forward: true }))).toEqual({ clear: true, after: 0 });
    expect(recovery(ended({ wasUp: true }))).toEqual({ clear: true, after: 0 });
    expect(recovery(ended({}))).toEqual({ clear: false, after: retryDelay(0) });
    expect(recovery(ended({ forward: true, wasUp: true, canClear: false }))).toEqual({
      clear: false,
      after: retryDelay(0),
    });
  });

  it('clears at most once in 5 minutes for a box not read running, and once in 20 s, waiting for it, for a running one', () => {
    const now = 10 * 60_000;
    const recently = { forward: true, clearedAt: now - 60_000, failures: 2 };
    expect(recovery(ended(recently))).toEqual({ clear: false, after: retryDelay(2) });
    expect(recovery(ended({ ...recently, clearedAt: now - TUNNEL_CLEAR_EVERY_MS }))).toEqual({
      clear: true,
      after: 0,
    });
    expect(recovery(ended({ ...recently, running: true, clearedAt: now - 5_000 }))).toEqual({
      clear: true,
      after: TUNNEL_CLEAR_COOLDOWN_MS - 5_000,
    });
    expect(
      recovery(ended({ wasUp: true, running: true, clearedAt: now - TUNNEL_CLEAR_COOLDOWN_MS })),
    ).toEqual({
      clear: true,
      after: 0,
    });
  });

  it('names why it clears in the log', () => {
    expect(clearingNote(true)).toBe("a tunnel's port on the machine is taken; clearing it");
    expect(clearingNote(false)).toBe("a tunnel that was up ended; clearing the machine's port first");
  });
});

describe('a tunnel coming back', () => {
  it('clears the port before its next try once a tunnel that was up ends, even without a forward failure', async () => {
    const w = world();
    w.tunnels.set([box]);
    await w.time.advance(TUNNEL_UP_AFTER_MS);
    expect(w.reports.at(-1)).toMatchObject({ state: 'up' });
    await w.ends(DEAD);
    expect(w.clearings()).toHaveLength(1);
    expect(w.reports.at(-1)).toMatchObject({
      state: 'down',
      error: `${DEAD} (clearing a stale holder of the box's port, then retrying)`,
    });
    expect(w.logs.messages('warn')).toContain(
      "a tunnel that was up ended; clearing the machine's port first",
    );
    expect(w.time.pending).toEqual([TUNNEL_CLEAR_TIMEOUT_MS]);
    await w.cleared();
    await w.time.advance(TUNNEL_CLEAR_RETRY_MS);
    expect(w.tries()).toHaveLength(2);
  });

  it('while the box reads running, clears before every try after a forward failure, at most once in 20 s', async () => {
    const w = world();
    w.tunnels.set([running]);
    await w.ends(FAILED);
    expect(w.clearings()).toHaveLength(1);
    await w.cleared();
    await w.time.advance(TUNNEL_CLEAR_RETRY_MS);
    // Taken again 2 s after the first clearing: the next one waits for the rest of the 20 s, and no try runs before it.
    await w.ends(FAILED);
    expect(w.clearings()).toHaveLength(1);
    expect(w.time.pending).toEqual([TUNNEL_CLEAR_COOLDOWN_MS - TUNNEL_CLEAR_RETRY_MS]);
    await w.time.advance(TUNNEL_CLEAR_COOLDOWN_MS - TUNNEL_CLEAR_RETRY_MS);
    expect([w.clearings().length, w.tries().length]).toEqual([2, 2]);
    await w.cleared();
    await w.time.advance(TUNNEL_CLEAR_RETRY_MS);
    expect(w.tries()).toHaveLength(3);
    // A stop while a clearing waits leaves nothing to run.
    await w.ends(FAILED);
    w.tunnels.set([]);
    expect(w.time.pending).toEqual([]);
  });

  it('waits at most 30 s between tries while the box reads running', async () => {
    const w = world(false);
    w.tunnels.set([running]);
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      await w.ends(DEAD);
      waits.push(w.time.pending[0] as number);
      await w.time.advance(w.time.pending[0] as number);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 30_000, 30_000, 30_000]);
  });

  it('starts a tunnel waiting out its backoff at once when its box turns running, and nothing else changes', async () => {
    const w = world(false);
    w.tunnels.set([box]);
    for (let i = 0; i < 4; i++) {
      await w.ends(DEAD);
      if (i < 3) await w.time.advance(w.time.pending[0] as number);
    }
    expect(w.time.pending).toEqual([retryDelay(3)]);
    w.tunnels.set([running]);
    expect(w.tries()).toHaveLength(5);
    expect(w.logs.messages('info')).toContain('the machine runs; starting its tunnel now');
    // Running again, or running while it is up: no new process and no stop.
    w.tunnels.set([running]);
    await w.time.advance(TUNNEL_UP_AFTER_MS);
    w.tunnels.set([box]);
    w.tunnels.set([running]);
    expect([w.tries().length, w.spawn.groupKills.length]).toEqual([5, 0]);
  });
});
