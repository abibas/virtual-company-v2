import { describe, expect, it } from 'vitest';
import { DEVBOX_KEEPALIVE_MS, devboxDriver } from '../../src/hold/devbox.ts';
import { DEVBOX_KEEPALIVE_BIN, type HoldDriver } from '../../src/hold/driver.ts';
import { HoldManager, type HoldReport, LIVE_RUNS_HOLD_MS } from '../../src/hold/manager.ts';
import { memoryLog } from '../fixtures/log.ts';
import { recordingDriver } from '../fixtures/runner.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

const MIN = 60_000;

function manager(driver?: HoldDriver) {
  const time = new FakeTime();
  const logs = memoryLog();
  const recording = recordingDriver();
  const reports: HoldReport[] = [];
  const hold = new HoldManager({
    driver: driver ?? recording.driver,
    clock: time,
    timers: time,
    log: logs.log,
    report: (state) => reports.push(state),
  });
  return { hold, time, logs, reports, calls: recording.calls };
}

describe('the server hold', () => {
  it('holds until the time the server says, refreshing every 5 minutes, then releases', async () => {
    const { hold, time, reports, calls } = manager();
    const until = time.now() + 12 * MIN;
    await hold.setServerHold(until);
    expect(calls).toEqual([{ step: 'apply', until }]);
    expect(reports).toEqual([{ until, source: 'server' }]);
    expect(hold.state).toEqual({ until, source: 'server' });
    expect(time.pending).toEqual([5 * MIN, 12 * MIN]);
    await time.advance(10 * MIN);
    expect(calls.slice(1)).toEqual([
      { step: 'refresh', until },
      { step: 'refresh', until },
    ]);
    expect(reports).toHaveLength(1);
    await time.advance(2 * MIN);
    expect(calls.at(-1)).toEqual({ step: 'apply', until: null });
    expect(reports.at(-1)).toEqual({ until: null, source: 'server' });
    expect(time.pending).toEqual([]);
  });

  it('keeps the refresh cadence across changes, and releases at once with null', async () => {
    const { hold, time, calls, reports } = manager();
    await hold.setServerHold(time.now() + 30 * MIN);
    await time.advance(3 * MIN);
    await hold.setServerHold(time.now() + 60 * MIN);
    expect(time.pending).toEqual([2 * MIN, 60 * MIN]);
    await hold.setServerHold(null);
    expect(calls.at(-1)).toEqual({ step: 'apply', until: null });
    expect(reports.at(-1)).toEqual({ until: null, source: 'server' });
    expect(time.pending).toEqual([]);
  });

  it('ignores a hold that already ended, and says nothing when nothing changed', async () => {
    const { hold, time, reports, calls } = manager();
    await hold.setServerHold(time.now() - 1);
    expect(calls).toEqual([{ step: 'apply', until: null }]);
    expect(reports).toEqual([]);
  });

  it('waits for a far end in steps Node can time', async () => {
    const { hold, time } = manager();
    await hold.setServerHold(time.now() + 40 * 24 * 60 * MIN);
    expect(time.pending).toEqual([5 * MIN, 2 ** 31 - 1]);
  });
});

describe('the hold while runs are live', () => {
  it('holds a rolling 20 minutes from the first run to the last, through refreshes', async () => {
    const { hold, time, reports, calls } = manager();
    await hold.setLiveRuns(2);
    expect(hold.liveRuns).toBe(2);
    expect(reports).toEqual([{ until: time.now() + LIVE_RUNS_HOLD_MS, source: 'live_runs' }]);
    await hold.setLiveRuns(3);
    expect(calls).toHaveLength(1);
    await time.advance(5 * MIN);
    expect(calls.at(-1)).toEqual({ step: 'refresh', until: time.now() + LIVE_RUNS_HOLD_MS });
    expect(reports.at(-1)).toEqual({ until: time.now() + LIVE_RUNS_HOLD_MS, source: 'live_runs' });
    await hold.setLiveRuns(0);
    expect(reports.at(-1)).toEqual({ until: null, source: 'live_runs' });
    expect(time.pending).toEqual([]);
    await hold.setLiveRuns(-2);
    expect(hold.liveRuns).toBe(0);
    expect(reports).toHaveLength(3);
  });

  it('is the later of the server hold and the runs, and outlasts the server hold while runs are live', async () => {
    const { hold, time, reports } = manager();
    const serverUntil = time.now() + 60 * MIN;
    await hold.setServerHold(serverUntil);
    await hold.setLiveRuns(1);
    expect(reports.at(-1)).toEqual({ until: serverUntil, source: 'live_runs' });
    await hold.setServerHold(time.now() + 10 * MIN);
    expect(reports.at(-1)).toEqual({ until: time.now() + LIVE_RUNS_HOLD_MS, source: 'server' });
    await time.advance(10 * MIN);
    // The server hold ended; the runs still hold the machine.
    expect(hold.state.until).toBe(time.now() + LIVE_RUNS_HOLD_MS);
    await hold.setLiveRuns(0);
    expect(hold.state).toEqual({ until: null, source: 'live_runs' });
  });

  it('counts open terminals as live work: held from the first run or terminal to the last of both', async () => {
    const { hold, time, reports } = manager();
    await hold.setTerminals(1);
    expect(reports).toEqual([{ until: time.now() + LIVE_RUNS_HOLD_MS, source: 'live_runs' }]);
    expect(hold.liveRuns).toBe(0);
    await hold.setLiveRuns(1);
    await hold.setTerminals(0);
    expect(reports).toHaveLength(1);
    await time.advance(5 * MIN);
    expect(hold.state.until).toBe(time.now() + LIVE_RUNS_HOLD_MS);
    await hold.setTerminals(2.7);
    await hold.setLiveRuns(0);
    expect(hold.state.until).toBe(time.now() + LIVE_RUNS_HOLD_MS);
    await hold.setTerminals(-1);
    expect(hold.state).toEqual({ until: null, source: 'live_runs' });
  });
});

describe('with the devbox driver', () => {
  it("runs devbox-keepalive '20 minutes' at the start and every 5 minutes while held, then lets it run out", async () => {
    const time = new FakeTime();
    const spawn = new FakeSpawn();
    let file = 0;
    spawn.when(DEVBOX_KEEPALIVE_BIN, (child, args) => {
      if (args[0] === '20 minutes') file = Math.floor((time.now() + DEVBOX_KEEPALIVE_MS) / 1000);
      child.finish();
    });
    const { log } = memoryLog();
    const driver = devboxDriver({
      spawn: spawn.spawn,
      readFile: async () => String(file),
      clock: time,
      timers: time,
      log,
    });
    const reports: HoldReport[] = [];
    const hold = new HoldManager({
      driver,
      clock: time,
      timers: time,
      log,
      report: (state) => reports.push(state),
    });
    const startedAt = time.now();
    await hold.setServerHold(startedAt + 17 * MIN);
    const runs = () => spawn.of(DEVBOX_KEEPALIVE_BIN).map((call) => call.args);
    expect(runs()).toEqual([['20 minutes']]);
    await time.advance(17 * MIN);
    expect(runs()).toHaveLength(4);
    expect(runs().every((args) => args.length === 1 && args[0] === '20 minutes')).toBe(true);
    expect(reports.map((report) => report.until)).toEqual([
      startedAt + 20 * MIN,
      startedAt + 25 * MIN,
      startedAt + 30 * MIN,
      startedAt + 35 * MIN,
      null,
    ]);
    await time.advance(60 * MIN);
    expect(runs()).toHaveLength(4);
  });
});

describe('looking again, closing and failures', () => {
  it('after a sleep releases a server hold that ended meanwhile, and refreshes one that goes on', async () => {
    const { hold, time, calls } = manager();
    await hold.setServerHold(time.now() + 30 * MIN);
    await hold.refresh();
    expect(calls.at(-1)?.step).toBe('refresh');
    time.sleep(45 * MIN);
    await hold.refresh();
    expect(calls.at(-1)).toEqual({ step: 'apply', until: null });
    await hold.refresh();
    expect(calls.at(-1)).toEqual({ step: 'apply', until: null });
  });

  it('stops its timers and releases the driver on close, and applies nothing after', async () => {
    const { hold, time, calls } = manager();
    await hold.setServerHold(time.now() + 30 * MIN);
    await hold.close();
    expect(calls.at(-1)).toEqual({ step: 'close' });
    expect(time.pending).toEqual([]);
    await hold.setServerHold(time.now() + 60 * MIN);
    expect(calls.at(-1)).toEqual({ step: 'close' });
  });

  it('logs a driver that throws and goes on with the next change, in order', async () => {
    let fail = true;
    const seen: (number | null)[] = [];
    const driver: HoldDriver = {
      kind: 'none',
      apply: async (until) => {
        seen.push(until);
        if (fail) throw new Error('caffeinate is gone');
        return until;
      },
      refresh: async (until) => until,
      close: async () => {},
    };
    const { hold, time, logs, reports } = manager(driver);
    const first = hold.setServerHold(time.now() + MIN);
    fail = false;
    const second = hold.setServerHold(time.now() + 2 * MIN);
    await Promise.all([first, second]);
    expect(logs.messages('error')).toEqual([]);
    fail = true;
    await hold.setServerHold(time.now() + 3 * MIN);
    expect(logs.entries.at(-1)).toMatchObject({
      msg: 'the hold could not be applied',
      error: 'caffeinate is gone',
    });
    expect(seen).toEqual([time.now() + 2 * MIN, time.now() + 2 * MIN, time.now() + 3 * MIN]);
    expect(reports).toEqual([{ until: time.now() + 2 * MIN, source: 'server' }]);
    fail = false;
    await hold.setServerHold(time.now() + 4 * MIN);
    expect(reports.at(-1)).toEqual({ until: time.now() + 4 * MIN, source: 'server' });
  });
});
