/** CPU use from `os.cpus()` times: the share of time not idle between two readings, over every core. */

/** One core's counters as `os.cpus()` gives them (milliseconds since boot). */
export interface CpuTimes {
  readonly user: number;
  readonly nice: number;
  readonly sys: number;
  readonly idle: number;
  readonly irq: number;
}

/** Busy and total milliseconds summed over every core. */
export interface CpuTotals {
  readonly busy: number;
  readonly total: number;
}

export function cpuTotals(cores: readonly { readonly times: CpuTimes }[]): CpuTotals {
  let busy = 0;
  let total = 0;
  for (const { times } of cores) {
    const coreBusy = times.user + times.nice + times.sys + times.irq;
    busy += coreBusy;
    total += coreBusy + times.idle;
  }
  return { busy, total };
}

/**
 * The percentage of CPU in use between two readings, rounded to a tenth. With no time between them (or counters that
 * went back, as after a core went offline), the average since boot of the later reading.
 */
export function cpuPercent(before: CpuTotals, after: CpuTotals): number {
  const total = after.total - before.total;
  const busy = after.busy - before.busy;
  const [part, whole] = total > 0 && busy >= 0 ? [busy, total] : [after.busy, after.total];
  if (whole <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (part / whole) * 100)) * 10) / 10;
}
