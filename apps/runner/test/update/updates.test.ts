import { newId } from '@mwc/shared/ids';
import type { RunnerUpdate } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { type SelfUpdate, UpdateError } from '../../src/update/self-update.ts';
import { RESTART_DELAY_MS, UPDATE_NOTICE, Updates } from '../../src/update/updates.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeTime } from '../fixtures/time.ts';

const BUILD = 'cd'.repeat(32);
const frame = (): RunnerUpdate => ({ type: 'runner.update', cmdId: newId() });

function updates(options: { update?: SelfUpdate; liveRuns?: number } = {}) {
  const time = new FakeTime();
  const logs = memoryLog();
  const closed: string[] = [];
  const servers: string[] = [];
  const handler = new Updates({
    update: options.update,
    serverUrl: () => 'http://127.0.0.1:9950',
    liveRuns: () => options.liveRuns ?? 0,
    closeTerminals: async (notice) => void closed.push(notice),
    timers: time,
    log: logs.log,
  });
  let restarted = false;
  void handler.restart.then(() => {
    restarted = true;
  });
  return { handler, time, logs, closed, servers, restarted: () => restarted };
}

/** A self-update that records its server and answers `outcome`. */
function selfUpdate(
  outcome: () => Promise<{ build: string; pty: boolean }>,
  servers: string[] = [],
): SelfUpdate {
  return {
    manager: 'launchd',
    apply: (serverUrl) => {
      servers.push(serverUrl);
      return outcome();
    },
  };
}

describe("the runner's runner.update", () => {
  it('answers unsupported when this runner cannot update itself', async () => {
    const { handler, restarted } = updates();
    expect(handler.available).toBe(false);
    const update = frame();
    expect(await handler.handle(update)).toEqual({
      type: 'runner.update.result',
      cmdId: update.cmdId,
      ok: false,
      error: 'unsupported: this runner is not an installed copy that launchd or systemd restarts',
    });
    expect(restarted()).toBe(false);
  });

  it('answers busy while runs are live, without touching anything', async () => {
    let applied = 0;
    const update = selfUpdate(async () => {
      applied++;
      return { build: BUILD, pty: true };
    });
    for (const [live, words] of [
      [1, '1 live run'],
      [3, '3 live runs'],
    ] as const) {
      const { handler } = updates({ update, liveRuns: live });
      expect((await handler.handle(frame())).error).toBe(`busy: ${words}; update it once they end`);
    }
    expect(applied).toBe(0);
  });

  it('puts the new runner in place, closes the terminals with a notice, answers its build, then restarts', async () => {
    const servers: string[] = [];
    const w = updates({ update: selfUpdate(async () => ({ build: BUILD, pty: true }), servers) });
    expect(w.handler.available).toBe(true);
    const update = frame();
    expect(await w.handler.handle(update)).toEqual({
      type: 'runner.update.result',
      cmdId: update.cmdId,
      ok: true,
      build: BUILD,
    });
    expect(servers).toEqual(['http://127.0.0.1:9950']);
    expect(w.closed).toEqual([UPDATE_NOTICE]);
    expect(w.restarted()).toBe(false);
    await w.time.advance(RESTART_DELAY_MS);
    expect(w.restarted()).toBe(true);
    expect(w.logs.messages('info')).toEqual([
      'updating this runner from the server',
      'updated; restarting on the new build',
    ]);
  });

  it('refuses a second update while one is under way or done', async () => {
    let finish: (value: { build: string; pty: boolean }) => void = () => {};
    const pending = new Promise<{ build: string; pty: boolean }>((resolve) => {
      finish = resolve;
    });
    const { handler } = updates({ update: selfUpdate(() => pending) });
    const first = handler.handle(frame());
    expect((await handler.handle(frame())).error).toBe('busy: an update is under way');
    finish({ build: BUILD, pty: false });
    expect((await first).ok).toBe(true);
    expect((await handler.handle(frame())).error).toBe('busy: an update is under way');
  });

  it('answers why an update failed, goes on as it was, and takes the next one', async () => {
    const failures = [
      new UpdateError('hash_mismatch', 'the runner does not match its SHA-256'),
      new Error('disk full'),
    ];
    const w = updates({
      update: selfUpdate(async () => {
        const failure = failures.shift();
        if (failure) throw failure;
        return { build: BUILD, pty: true };
      }),
    });
    expect((await w.handler.handle(frame())).error).toBe(
      'hash_mismatch: the runner does not match its SHA-256',
    );
    expect((await w.handler.handle(frame())).error).toBe('write_failed: disk full');
    expect(w.closed).toEqual([]);
    expect(w.logs.messages('warn')).toHaveLength(2);
    expect((await w.handler.handle(frame())).ok).toBe(true);
  });

  it('cuts a long error to the protocol limit', async () => {
    const { handler } = updates({
      update: selfUpdate(async () => {
        throw new UpdateError('download_failed', 'x'.repeat(3000));
      }),
    });
    expect((await handler.handle(frame())).error).toHaveLength(2000);
  });
});
