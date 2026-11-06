import { RunnerHeartbeat } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { Heartbeats, SLEEP_GAP_MS } from '../../src/link/heartbeat.ts';
import { memoryLog } from '../fixtures/log.ts';
import { fakeSampler } from '../fixtures/runner.ts';
import { FakeTime } from '../fixtures/time.ts';

function heartbeats(liveRuns = 0) {
  const time = new FakeTime();
  const sampler = fakeSampler(time);
  const logs = memoryLog();
  const beats = new Heartbeats({ clock: time, sampler, liveRuns: () => liveRuns, log: logs.log });
  return { beats, time, sampler, logs };
}

describe('the heartbeats', () => {
  it('carry awake time, the load, no runs and no backlog yet, the wall clock, and a sample once a minute', async () => {
    const { beats, time, sampler } = heartbeats(1);
    const first = await beats.next();
    expect(RunnerHeartbeat.parse(first.frame)).toEqual(first.frame);
    expect(first).toEqual({
      frame: expect.objectContaining({ awakeMs: 0, load1: 0.5, liveRuns: [], backlog: 0, now: time.now() }),
      slept: false,
      gapMs: 0,
    });
    expect(first.frame.sample).toMatchObject({ liveRuns: 1, at: time.now() });
    const withSample: boolean[] = [first.frame.sample !== undefined];
    for (let beat = 0; beat < 6; beat++) {
      await time.advance(20_000);
      withSample.push((await beats.next()).frame.sample !== undefined);
    }
    expect(withSample).toEqual([true, false, false, true, false, false, true]);
    expect(sampler.taken).toHaveLength(3);
  });

  it('count awake time from the monotonic clock, so a sleep does not add to it', async () => {
    const { beats, time } = heartbeats();
    await time.advance(20_000);
    time.sleep(10 * 60_000);
    await time.advance(20_000);
    expect(beats.awakeMs()).toBe(40_000);
  });

  it('say the machine slept when the wall time between two heartbeats is over two intervals', async () => {
    const { beats, time } = heartbeats();
    await beats.next();
    await time.advance(20_000);
    expect((await beats.next()).slept).toBe(false);
    time.sleep(SLEEP_GAP_MS - 20_000);
    await time.advance(20_000);
    expect(await beats.next()).toMatchObject({ slept: false, gapMs: SLEEP_GAP_MS });
    time.sleep(SLEEP_GAP_MS - 20_000 + 1);
    await time.advance(20_000);
    expect(await beats.next()).toMatchObject({ slept: true, gapMs: SLEEP_GAP_MS + 1 });
  });

  it('take a fresh sample after a sleep, and measure no gap on a new connection', async () => {
    const { beats, time, sampler } = heartbeats();
    await beats.next();
    time.sleep(5 * 60_000);
    beats.connected();
    const next = await beats.next();
    expect(next).toMatchObject({ slept: false, gapMs: 0 });
    expect(next.frame.sample).toBeDefined();
    expect(sampler.taken).toHaveLength(2);
  });

  it('take a sample again when the wall clock went back, and go on without one when sampling fails', async () => {
    const { beats, time, sampler, logs } = heartbeats();
    await beats.next();
    time.wall -= 1_000;
    expect((await beats.next()).frame.sample).toBeDefined();
    sampler.sample = async () => {
      throw new Error('statfs failed');
    };
    time.wall += 61_000;
    const failed = await beats.next();
    expect(failed.frame.sample).toBeUndefined();
    expect(failed.frame.load1).toBe(0.5);
    expect(logs.entries.at(-1)).toMatchObject({ msg: 'cannot take a sample', error: 'statfs failed' });
  });
});
