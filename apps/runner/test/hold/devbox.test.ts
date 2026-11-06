import { describe, expect, it } from 'vitest';
import { DEVBOX_KEEPALIVE_MS, devboxDriver, readKeepalive } from '../../src/hold/devbox.ts';
import { DEVBOX_KEEPALIVE_BIN, DEVBOX_KEEPALIVE_FILE } from '../../src/hold/driver.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

/** The box: its keepalive file, and a `devbox-keepalive` that writes now + its duration as GNU date reads it. */
function box(fileEpochS: number | null | string = null) {
  const time = new FakeTime();
  const logs = memoryLog();
  const spawn = new FakeSpawn();
  const state = { file: fileEpochS === null ? null : String(fileEpochS), writes: 0 };
  spawn.when(DEVBOX_KEEPALIVE_BIN, (child, args) => {
    // `'20m'` writes nothing on the box: only the spelled-out duration moves the file.
    if (args[0] === '20 minutes') {
      state.file = String(Math.floor((time.now() + DEVBOX_KEEPALIVE_MS) / 1000));
      state.writes += 1;
    }
    child.finish();
  });
  const reads: string[] = [];
  const driver = devboxDriver({
    spawn: spawn.spawn,
    readFile: async (path) => {
      reads.push(path);
      if (state.file === null) throw new Error('ENOENT');
      return `${state.file}\n`;
    },
    clock: time,
    timers: time,
    log: logs.log,
  });
  return { time, logs, spawn, state, reads, driver };
}

const seconds = (ms: number) => Math.floor(ms / 1000);

describe('reading the keepalive file', () => {
  it('is the epoch in milliseconds, or null when missing or not an epoch', async () => {
    expect(await readKeepalive(async () => '1762419600\n')).toBe(1_762_419_600_000);
    expect(await readKeepalive(async () => 'off')).toBeNull();
    expect(
      await readKeepalive(async () => {
        throw new Error('ENOENT');
      }),
    ).toBeNull();
  });
});

describe('the devbox hold', () => {
  it("runs devbox-keepalive '20 minutes' (exactly that text) when the hold starts and the file ends sooner", async () => {
    const { driver, spawn, state, time, reads } = box();
    expect(driver.kind).toBe('devbox_keepalive');
    const until = await driver.apply(time.now() + 45 * 60_000);
    expect(spawn.calls.map((call) => [call.file, ...call.args])).toEqual([
      [DEVBOX_KEEPALIVE_BIN, '20 minutes'],
    ]);
    expect(spawn.calls[0]?.args).not.toContain('20m');
    expect(state.writes).toBe(1);
    expect(until).toBe(seconds(time.now() + DEVBOX_KEEPALIVE_MS) * 1000);
    expect(reads).toEqual([DEVBOX_KEEPALIVE_FILE, DEVBOX_KEEPALIVE_FILE]);
  });

  it('never shortens a longer hold someone set, and never writes off', async () => {
    const time = new FakeTime();
    const later = seconds(time.now() + 2 * 60 * 60_000);
    const { driver, spawn, state } = box(later);
    expect(await driver.apply(time.now() + 60_000)).toBe(later * 1000);
    expect(await driver.refresh(time.now() + 60_000)).toBe(later * 1000);
    await driver.apply(null);
    expect(spawn.calls).toEqual([]);
    expect(state.file).toBe(String(later));
  });

  it('refreshes at each refresh, not at every change while held, and stops refreshing on release', async () => {
    const { driver, spawn, time, state } = box();
    const first = await driver.apply(time.now() + 60 * 60_000);
    await time.advance(60_000);
    expect(await driver.apply(time.now() + 90 * 60_000)).toBe(first);
    expect(spawn.calls).toHaveLength(1);
    await time.advance(4 * 60_000);
    const second = await driver.refresh(time.now() + 90 * 60_000);
    expect(spawn.calls).toHaveLength(2);
    expect(second).toBe(seconds(time.now() + DEVBOX_KEEPALIVE_MS) * 1000);
    expect(await driver.apply(null)).toBeNull();
    await time.advance(30 * 60_000);
    expect(spawn.calls).toHaveLength(2);
    expect(state.file).toBe(String(seconds(second as number)));
    await driver.apply(time.now() + 60_000);
    expect(spawn.calls).toHaveLength(3);
    await driver.close();
    await time.advance(60_000);
    await driver.apply(time.now() + 60_000);
    expect(spawn.calls).toHaveLength(4);
  });

  it('says so when devbox-keepalive fails or does not move the file, and reports what the file holds', async () => {
    const { driver, spawn, logs, time, state } = box('garbage');
    spawn.when(DEVBOX_KEEPALIVE_BIN, (child) => child.finish('', 1));
    expect(await driver.apply(time.now() + 60_000)).toBeNull();
    const before = seconds(time.now() + 60_000);
    state.file = String(before);
    spawn.when(DEVBOX_KEEPALIVE_BIN, (child) => child.finish('', 0));
    expect(await driver.refresh(time.now() + 60_000)).toBe(before * 1000);
    expect(logs.entries.filter((entry) => entry.level === 'warn')).toEqual([
      expect.objectContaining({
        msg: 'devbox-keepalive did not extend the hold',
        code: 1,
        before: null,
        after: null,
      }),
      expect.objectContaining({
        msg: 'devbox-keepalive did not extend the hold',
        code: 0,
        before: before * 1000,
      }),
    ]);
  });
});
