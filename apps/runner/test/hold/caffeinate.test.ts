import { describe, expect, it } from 'vitest';
import { caffeinateDriver } from '../../src/hold/caffeinate.ts';
import { CAFFEINATE_BIN } from '../../src/hold/driver.ts';
import { memoryLog } from '../fixtures/log.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { settle } from '../fixtures/time.ts';

function mac() {
  const spawn = new FakeSpawn();
  const logs = memoryLog();
  const driver = caffeinateDriver({ spawn: spawn.spawn, pid: 4242, log: logs.log });
  return { spawn, logs, driver };
}

describe("This Mac's hold", () => {
  it('keeps one caffeinate -i -w <runner pid> child while held, and kills it on release', async () => {
    const { driver, spawn } = mac();
    expect(driver.kind).toBe('caffeinate');
    expect(await driver.apply(1_000)).toBe(1_000);
    expect(await driver.apply(2_000)).toBe(2_000);
    expect(await driver.refresh(3_000)).toBe(3_000);
    expect(spawn.calls.map((call) => [call.file, ...call.args])).toEqual([
      [CAFFEINATE_BIN, '-i', '-w', '4242'],
    ]);
    expect(spawn.calls[0]?.options.stdio).toEqual(['ignore', 'ignore', 'ignore']);
    expect(await driver.apply(null)).toBeNull();
    expect(spawn.calls[0]?.child.signals).toEqual(['SIGTERM']);
    await settle();
    expect(await driver.apply(null)).toBeNull();
    expect(spawn.calls[0]?.child.signals).toEqual(['SIGTERM']);
  });

  it('kills the child when the runner stops', async () => {
    const { driver, spawn } = mac();
    await driver.apply(1_000);
    await driver.close();
    expect(spawn.calls[0]?.child.signals).toEqual(['SIGTERM']);
    await driver.close();
    expect(spawn.calls[0]?.child.signals).toEqual(['SIGTERM']);
  });

  it('starts a child that ended by itself again at the next refresh, and says so', async () => {
    const { driver, spawn, logs } = mac();
    await driver.apply(1_000);
    spawn.calls[0]?.child.exit(0);
    await settle();
    expect(logs.messages('warn')).toEqual(['caffeinate ended while the Mac is held']);
    expect(await driver.refresh(2_000)).toBe(2_000);
    expect(spawn.calls).toHaveLength(2);
    await driver.apply(null);
    // The released child's exit is expected: no warning.
    await settle();
    expect(logs.messages('warn')).toHaveLength(1);
  });

  it('reports no hold when caffeinate cannot start, and tries again later', async () => {
    const { driver, spawn, logs } = mac();
    spawn.throwsFor.add(CAFFEINATE_BIN);
    expect(await driver.apply(1_000)).toBeNull();
    expect(await driver.refresh(1_500)).toBeNull();
    expect(logs.messages('error')).toEqual(['cannot start caffeinate', 'cannot start caffeinate']);
    spawn.throwsFor.clear();
    spawn.when(CAFFEINATE_BIN, (child) => child.fail());
    expect(await driver.refresh(2_000)).toBe(2_000);
    await settle();
    expect(logs.messages('error')).toEqual([
      'cannot start caffeinate',
      'cannot start caffeinate',
      'caffeinate failed',
    ]);
    expect(await driver.refresh(3_000)).toBe(3_000);
    expect(spawn.calls).toHaveLength(2);
  });
});
