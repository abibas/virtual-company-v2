/**
 * The home board's machine stats (S4.2, docs/machines.md "Stats"), as pure functions of a machine's samples and runner
 * sessions at a given instant. Times are milliseconds since the epoch; the service turns them into ISO strings.
 */

const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const WEEK_MS = 7 * DAY_MS;

/** A sample is "now" while it is under 3 minutes old. */
export const NOW_MAX_AGE_MS = 3 * MINUTE_MS;

/** The load sparkline's buckets: 5 minutes each, 288 over 24 hours. */
export const SERIES_BUCKET_MS = 5 * MINUTE_MS;

/** A sample is overloaded above one runnable process per CPU or 85% CPU; the badge shows past half of 24 hours. */
export const OVERLOAD = { loadPerCpu: 1, cpuPct: 85, badgeShare: 0.5 } as const;

/** What the stats read of a sample (`machine_samples`). */
export interface StatSample {
  readonly at: number;
  readonly load1: number;
  readonly cpus: number;
  readonly cpuPct: number;
  readonly memPct: number;
  readonly diskUsed: number;
  readonly diskTotal: number;
}

/** A runner session (`runner_sessions`): open while `disconnectedAt` is null. */
export interface SessionSpan {
  readonly connectedAt: number;
  readonly disconnectedAt: number | null;
}

/** A stretch of a window when the machine's runner was connected (`up`) or not. */
export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly up: boolean;
}

/** The latest sample, when it is fresh. */
export interface NowStats {
  readonly at: number;
  readonly load1: number;
  readonly cpus: number;
  readonly loadPerCpu: number;
  readonly cpuPct: number;
  readonly memPct: number;
  readonly diskUsed: number;
  readonly diskTotal: number;
}

export interface SeriesPoint {
  /** The bucket's start. */
  readonly at: number;
  /** The mean load per CPU of the bucket's samples; null for a bucket without any. */
  readonly loadPerCpu: number | null;
}

export interface Overload {
  readonly now: boolean;
  /** The share of the last 24 hours' samples that were overloaded, 0 to 1 (0 without samples). */
  readonly share24h: number;
  readonly badge: boolean;
}

export interface MachineStats {
  readonly now: NowStats | null;
  readonly upSince: number | null;
  readonly runtime: { readonly h24Ms: number; readonly d7Ms: number };
  /** The time agent runs took on it in 24 hours; null until runs exist (S5). */
  readonly agentRuns24hMs: null;
  readonly series: SeriesPoint[];
  readonly upDown: { readonly h24: Segment[]; readonly d7: Segment[] };
  readonly overloaded: Overload;
}

export const loadPerCpu = (sample: Pick<StatSample, 'load1' | 'cpus'>): number => sample.load1 / sample.cpus;

/** Overloaded: load1 per CPU above 1.0, or CPU above 85%. */
export function isOverloaded(sample: Pick<StatSample, 'load1' | 'cpus' | 'cpuPct'>): boolean {
  return loadPerCpu(sample) > OVERLOAD.loadPerCpu || sample.cpuPct > OVERLOAD.cpuPct;
}

/** The latest sample if it is under 3 minutes old at `nowMs`, else null. */
export function nowStats(samples: readonly StatSample[], nowMs: number): NowStats | null {
  let latest: StatSample | undefined;
  for (const sample of samples) if (latest === undefined || sample.at > latest.at) latest = sample;
  if (latest === undefined || nowMs - latest.at >= NOW_MAX_AGE_MS) return null;
  const { at, load1, cpus, cpuPct, memPct, diskUsed, diskTotal } = latest;
  return { at, load1, cpus, loadPerCpu: loadPerCpu(latest), cpuPct, memPct, diskUsed, diskTotal };
}

/**
 * The mean load per CPU in each 5-minute bucket of the 24 hours that end with the bucket `nowMs` is in: 288 points,
 * oldest first, aligned to the clock (12:00, 12:05, …).
 */
export function loadSeries(samples: readonly StatSample[], nowMs: number): SeriesPoint[] {
  const count = DAY_MS / SERIES_BUCKET_MS;
  const end = Math.floor(nowMs / SERIES_BUCKET_MS) * SERIES_BUCKET_MS + SERIES_BUCKET_MS;
  const start = end - DAY_MS;
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  for (const sample of samples) {
    if (sample.at < start || sample.at >= end) continue;
    const index = Math.floor((sample.at - start) / SERIES_BUCKET_MS);
    sums[index] = (sums[index] as number) + loadPerCpu(sample);
    counts[index] = (counts[index] as number) + 1;
  }
  return sums.map((sum, index) => {
    const n = counts[index] as number;
    return { at: start + index * SERIES_BUCKET_MS, loadPerCpu: n === 0 ? null : sum / n };
  });
}

/** The sessions as disjoint spans up to `nowMs`, oldest first: an open one runs to `nowMs`, overlapping ones merge. */
function mergedSpans(sessions: readonly SessionSpan[], nowMs: number): [number, number][] {
  const spans = sessions
    .map((session): [number, number] => [
      session.connectedAt,
      Math.min(session.disconnectedAt ?? nowMs, nowMs),
    ])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of spans) {
    const last = merged.at(-1);
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** The window of `windowMs` before `nowMs` as up and down segments, covering it end to end, oldest first. */
export function upDown(sessions: readonly SessionSpan[], nowMs: number, windowMs: number): Segment[] {
  const start = nowMs - windowMs;
  const segments: Segment[] = [];
  let cursor = start;
  for (const [spanFrom, spanTo] of mergedSpans(sessions, nowMs)) {
    const from = Math.max(spanFrom, start);
    if (spanTo <= from) continue;
    if (from > cursor) segments.push({ from: cursor, to: from, up: false });
    segments.push({ from, to: spanTo, up: true });
    cursor = spanTo;
  }
  if (cursor < nowMs) segments.push({ from: cursor, to: nowMs, up: false });
  return segments;
}

/** How long the segments were up. */
export const upTimeMs = (segments: readonly Segment[]): number =>
  segments.reduce((total, segment) => total + (segment.up ? segment.to - segment.from : 0), 0);

/**
 * When the current online stretch began: the start of the merged span an open session ends at `nowMs`, so a connection
 * that replaced another without a gap keeps the earlier start; null without an open session.
 */
export function upSince(sessions: readonly SessionSpan[], nowMs: number): number | null {
  const open = sessions.some((session) => session.disconnectedAt === null && session.connectedAt < nowMs);
  if (!open) return null;
  return mergedSpans(sessions, nowMs).at(-1)?.[0] ?? null;
}

/** Overloaded now (the fresh sample), the overloaded share of the last 24 hours, and whether the badge shows. */
export function overload(samples: readonly StatSample[], now: NowStats | null, nowMs: number): Overload {
  const recent = samples.filter((sample) => sample.at > nowMs - DAY_MS && sample.at <= nowMs);
  const share24h = recent.length === 0 ? 0 : recent.filter(isOverloaded).length / recent.length;
  const overloadedNow = now !== null && isOverloaded(now);
  return { now: overloadedNow, share24h, badge: overloadedNow || share24h > OVERLOAD.badgeShare };
}

/**
 * A machine's whole stats row at `nowMs`. `online` says whether it counts as up now (its status): an offline machine has
 * no `upSince` even with a session left open (a server that crashed before the sweep).
 */
export function machineStats(input: {
  readonly samples: readonly StatSample[];
  readonly sessions: readonly SessionSpan[];
  readonly online: boolean;
  readonly nowMs: number;
}): MachineStats {
  const { samples, sessions, nowMs } = input;
  const now = nowStats(samples, nowMs);
  const h24 = upDown(sessions, nowMs, DAY_MS);
  const d7 = upDown(sessions, nowMs, WEEK_MS);
  return {
    now,
    upSince: input.online ? upSince(sessions, nowMs) : null,
    runtime: { h24Ms: upTimeMs(h24), d7Ms: upTimeMs(d7) },
    agentRuns24hMs: null,
    series: loadSeries(samples, nowMs),
    upDown: { h24, d7 },
    overloaded: overload(samples, now, nowMs),
  };
}
