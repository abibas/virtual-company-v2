import { MACHINE_SAMPLE_MS } from '@mwc/shared/runner-protocol';
import type { Log } from '../log.ts';
import { runCommand, type Spawn } from '../system/process.ts';
import type { Clock, Timers } from '../system/time.ts';

/**
 * The share of memory in use, the way each system tells it best. macOS: `100 - kern.memorystatus_level` (the kernel's
 * own pressure gauge; `os.freemem()` counts the file cache as used and reads near 100 % on a healthy Mac), read with one
 * `sysctl` start a minute at most, since the Mac's security agent bills each start. Linux: `/proc/meminfo`'s
 * MemAvailable over MemTotal, a file read. Elsewhere, or when those fail: `os.freemem()` over `os.totalmem()`.
 */

export const SYSCTL = '/usr/sbin/sysctl';
export const MEMINFO = '/proc/meminfo';

export interface MemoryDeps {
  readonly platform: NodeJS.Platform;
  readonly os: { freemem(): number; totalmem(): number };
  readonly readFile: (path: string) => Promise<string>;
  readonly spawn: Spawn;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly log: Log;
}

/** A percentage rounded to a tenth, kept within 0–100. */
export function percent(used: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round(Math.min(100, Math.max(0, (used / total) * 100)) * 10) / 10;
}

/** Memory in use from `/proc/meminfo`, or undefined when it lacks MemTotal or MemAvailable. */
export function parseMeminfo(text: string): number | undefined {
  const kib = (field: string) => {
    const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return match ? Number(match[1]) : undefined;
  };
  const total = kib('MemTotal');
  const available = kib('MemAvailable');
  if (total === undefined || available === undefined || total === 0) return undefined;
  return percent(total - available, total);
}

/** Memory in use from `sysctl -n kern.memorystatus_level` (the share free, 0–100), or undefined. */
export function parseMemorystatusLevel(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const level = Number(trimmed);
  return level > 100 ? undefined : 100 - level;
}

/** A reader of memory in use for this machine. */
export function createMemoryReader(deps: MemoryDeps): () => Promise<number> {
  const fallback = () => percent(deps.os.totalmem() - deps.os.freemem(), deps.os.totalmem());
  if (deps.platform === 'linux') {
    return async () => {
      try {
        return parseMeminfo(await deps.readFile(MEMINFO)) ?? fallback();
      } catch {
        return fallback();
      }
    };
  }
  if (deps.platform !== 'darwin') return async () => fallback();
  let last: { at: number; value: number } | undefined;
  let warned = false;
  return async () => {
    const now = deps.clock.now();
    if (last && now - last.at < MACHINE_SAMPLE_MS && now >= last.at) return last.value;
    const result = await runCommand(SYSCTL, ['-n', 'kern.memorystatus_level'], deps);
    const value = result.code === 0 ? parseMemorystatusLevel(result.stdout) : undefined;
    if (value === undefined && !warned) {
      warned = true;
      deps.log.warn('cannot read kern.memorystatus_level; using free memory', {
        code: result.code,
        error: result.error,
      });
    }
    last = { at: now, value: value ?? fallback() };
    return last.value;
  };
}
