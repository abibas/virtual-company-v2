import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  isOverloaded,
  loadPerCpu,
  loadSeries,
  machineStats,
  NOW_MAX_AGE_MS,
  nowStats,
  OVERLOAD,
  overload,
  SERIES_BUCKET_MS,
  type SessionSpan,
  type StatSample,
  upDown,
  upSince,
  upTimeMs,
  WEEK_MS,
} from '../../../../src/modules/machines/rules/stats.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 12:00:00 UTC, on a bucket boundary. */
const NOW = Date.parse('2026-11-06T12:00:00.000Z');

const sample = (at: number, fields: Partial<StatSample> = {}): StatSample => ({
  at,
  load1: 2,
  cpus: 8,
  cpuPct: 30,
  memPct: 50,
  diskUsed: 100,
  diskTotal: 400,
  ...fields,
});
const session = (connectedAt: number, disconnectedAt: number | null): SessionSpan => ({
  connectedAt,
  disconnectedAt,
});

describe('the overload rule', () => {
  it('is load1 per CPU above 1.0, or CPU above 85%; exactly at either is not', () => {
    expect(OVERLOAD).toEqual({ loadPerCpu: 1, cpuPct: 85, badgeShare: 0.5 });
    expect(loadPerCpu({ load1: 6, cpus: 4 })).toBe(1.5);
    expect(isOverloaded({ load1: 8.01, cpus: 8, cpuPct: 10 })).toBe(true);
    expect(isOverloaded({ load1: 8, cpus: 8, cpuPct: 85 })).toBe(false);
    expect(isOverloaded({ load1: 0.1, cpus: 8, cpuPct: 85.5 })).toBe(true);
  });
});

describe('nowStats', () => {
  it('is the latest sample while under 3 minutes old, with its load per CPU', () => {
    const samples = [
      sample(NOW - 2 * MINUTE, { load1: 4 }),
      sample(NOW - MINUTE, { load1: 12 }),
      sample(NOW - HOUR),
    ];
    expect(nowStats(samples, NOW)).toEqual({
      at: NOW - MINUTE,
      load1: 12,
      cpus: 8,
      loadPerCpu: 1.5,
      cpuPct: 30,
      memPct: 50,
      diskUsed: 100,
      diskTotal: 400,
    });
  });

  it('is null for a stale latest sample (3 minutes old already) and without samples', () => {
    expect(NOW_MAX_AGE_MS).toBe(3 * MINUTE);
    expect(nowStats([sample(NOW - 3 * MINUTE)], NOW)).toBeNull();
    expect(nowStats([sample(NOW - 3 * MINUTE + 1)], NOW)).not.toBeNull();
    expect(nowStats([], NOW)).toBeNull();
  });
});

describe('loadSeries', () => {
  it('gives 288 five-minute buckets ending with the one now is in, oldest first, null where nothing came', () => {
    const series = loadSeries([], NOW + 2 * MINUTE);
    expect(SERIES_BUCKET_MS).toBe(5 * MINUTE);
    expect(series).toHaveLength(288);
    expect(series.at(-1)).toEqual({ at: NOW, loadPerCpu: null });
    expect(series[0]?.at).toBe(NOW + 5 * MINUTE - DAY_MS);
    expect(series.every((point) => point.loadPerCpu === null)).toBe(true);
  });

  it("averages each bucket's load per CPU and leaves out samples outside the 24 hours", () => {
    const samples = [
      sample(NOW - 5 * MINUTE, { load1: 4 }),
      sample(NOW - 4 * MINUTE, { load1: 12 }),
      sample(NOW - MINUTE, { load1: 8, cpus: 4 }),
      sample(NOW + MINUTE, { load1: 16 }),
      sample(NOW + 5 * MINUTE - DAY_MS, { load1: 0 }),
      sample(NOW + 5 * MINUTE - DAY_MS - 1, { load1: 80 }),
    ];
    const series = loadSeries(samples, NOW + MINUTE);
    expect(series.at(-1)).toEqual({ at: NOW, loadPerCpu: 2 });
    expect(series.at(-2)).toEqual({ at: NOW - 5 * MINUTE, loadPerCpu: (0.5 + 1.5 + 2) / 3 });
    expect(series[0]).toEqual({ at: NOW + 5 * MINUTE - DAY_MS, loadPerCpu: 0 });
  });
});

describe('upDown and upTimeMs', () => {
  it('covers the window with merged up stretches and the down gaps between them', () => {
    const sessions = [
      session(NOW - 30 * HOUR, NOW - 25 * HOUR),
      session(NOW - 10 * HOUR, NOW - 8 * HOUR),
      session(NOW - 9 * HOUR, NOW - 6 * HOUR),
      session(NOW - 6 * HOUR, NOW - 5 * HOUR),
      session(NOW - HOUR, null),
    ];
    const h24 = upDown(sessions, NOW, DAY_MS);
    expect(h24).toEqual([
      { from: NOW - DAY_MS, to: NOW - 10 * HOUR, up: false },
      { from: NOW - 10 * HOUR, to: NOW - 5 * HOUR, up: true },
      { from: NOW - 5 * HOUR, to: NOW - HOUR, up: false },
      { from: NOW - HOUR, to: NOW, up: true },
    ]);
    expect(upTimeMs(h24)).toBe(6 * HOUR);
    const d7 = upDown(sessions, NOW, WEEK_MS);
    expect(d7[1]).toEqual({ from: NOW - 30 * HOUR, to: NOW - 25 * HOUR, up: true });
    expect(upTimeMs(d7)).toBe(11 * HOUR);
  });

  it('cuts a stretch at the window edge and counts only what lies inside', () => {
    const across = [session(NOW - 26 * HOUR, NOW - 22 * HOUR)];
    expect(upDown(across, NOW, DAY_MS)).toEqual([
      { from: NOW - DAY_MS, to: NOW - 22 * HOUR, up: true },
      { from: NOW - 22 * HOUR, to: NOW, up: false },
    ]);
    expect(upTimeMs(upDown([session(NOW - 8 * 24 * HOUR, null)], NOW, WEEK_MS))).toBe(WEEK_MS);
    expect(upDown([session(NOW - 30 * HOUR, NOW - 25 * HOUR)], NOW, DAY_MS)).toEqual([
      { from: NOW - DAY_MS, to: NOW, up: false },
    ]);
  });

  it('drops empty spans and the part of a session past now (a clock ahead)', () => {
    const odd = [
      session(NOW - HOUR, NOW - HOUR),
      session(NOW - 2 * HOUR, NOW + HOUR),
      session(NOW + MINUTE, null),
    ];
    expect(upDown(odd, NOW, DAY_MS)).toEqual([
      { from: NOW - DAY_MS, to: NOW - 2 * HOUR, up: false },
      { from: NOW - 2 * HOUR, to: NOW, up: true },
    ]);
    expect(upDown([], NOW, DAY_MS)).toEqual([{ from: NOW - DAY_MS, to: NOW, up: false }]);
  });
});

describe('upSince', () => {
  it('is the start of the stretch an open session ends, earlier sessions joined without a gap', () => {
    const replaced = [session(NOW - 3 * HOUR, NOW - HOUR), session(NOW - HOUR, null)];
    expect(upSince(replaced, NOW)).toBe(NOW - 3 * HOUR);
    expect(upSince([session(NOW - 3 * HOUR, NOW - 2 * HOUR), session(NOW - HOUR, null)], NOW)).toBe(
      NOW - HOUR,
    );
    expect(upSince([session(NOW - 20 * 24 * HOUR, null)], NOW)).toBe(NOW - 20 * 24 * HOUR);
  });

  it('is null without an open session, or with one that has not begun yet', () => {
    expect(upSince([session(NOW - 3 * HOUR, NOW - HOUR)], NOW)).toBeNull();
    expect(upSince([session(NOW, null)], NOW)).toBeNull();
    expect(upSince([], NOW)).toBeNull();
  });
});

describe('overload', () => {
  const calm = sample(NOW - MINUTE);
  const hot = sample(NOW - MINUTE, { cpuPct: 99 });

  it('shows the badge when overloaded now, whatever the share', () => {
    const now = nowStats([hot], NOW);
    expect(overload([hot, sample(NOW - 2 * HOUR), sample(NOW - 3 * HOUR)], now, NOW)).toEqual({
      now: true,
      share24h: 1 / 3,
      badge: true,
    });
  });

  it('shows the badge past half of the last 24 hours overloaded, not at exactly half', () => {
    const older = (hours: number, fields: Partial<StatSample>) => sample(NOW - hours * HOUR, fields);
    const past = [older(2, { cpuPct: 90 }), older(3, { load1: 9 }), older(4, {})];
    expect(overload([...past, calm], nowStats([calm], NOW), NOW)).toEqual({
      now: false,
      share24h: 0.5,
      badge: false,
    });
    expect(overload([...past, older(5, { cpuPct: 86 }), calm], null, NOW)).toEqual({
      now: false,
      share24h: 0.6,
      badge: true,
    });
  });

  it('counts only the last 24 hours, and is all quiet without samples', () => {
    expect(overload([sample(NOW - DAY_MS, { cpuPct: 99 }), calm], null, NOW).share24h).toBe(0);
    expect(overload([], null, NOW)).toEqual({ now: false, share24h: 0, badge: false });
  });
});

describe('machineStats', () => {
  it("puts a machine's row together, with no runs time before S5 and no uptime while offline", () => {
    const sessions = [session(NOW - 2 * HOUR, null)];
    const samples = [sample(NOW - MINUTE, { load1: 16 })];
    const online = machineStats({ samples, sessions, online: true, nowMs: NOW });
    expect(online).toMatchObject({
      now: { loadPerCpu: 2 },
      upSince: NOW - 2 * HOUR,
      runtime: { h24Ms: 2 * HOUR, d7Ms: 2 * HOUR },
      agentRuns24hMs: null,
      overloaded: { now: true, share24h: 1, badge: true },
    });
    expect(online.series).toHaveLength(288);
    expect(online.upDown.d7.at(-1)).toEqual({ from: NOW - 2 * HOUR, to: NOW, up: true });
    expect(machineStats({ samples: [], sessions, online: false, nowMs: NOW }).upSince).toBeNull();
  });
});
