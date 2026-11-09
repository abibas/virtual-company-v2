import type { Clock } from '../system/time.ts';
import { percent } from './memory.ts';

/**
 * A container's own limits and use, from its cgroup v2 files (docs/machines.md, "Installing a runner"): inside a
 * container `os.cpus()` and `/proc/meminfo` describe the Docker VM, not the container. CPUs are `cpu.max`'s quota over
 * its period, CPU use the `cpu.stat` `usage_usec` between two readings against that limit, memory `memory.current`
 * (less the file cache that can be dropped, `inactive_file` in `memory.stat`, as `docker stats` counts it) over
 * `memory.max`. Each part is undefined when its file is missing, unreadable or unlimited (`max`), and the sampler keeps
 * today's numbers for it. Read only when the runner knows it is in a container.
 */

/** Where a container sees its own cgroup (v2, the unified hierarchy). */
export const CGROUP_DIR = '/sys/fs/cgroup';

export interface CgroupDeps {
  readonly readFile: (path: string) => Promise<string>;
  readonly clock: Clock;
  /** The cgroup folder; CGROUP_DIR by default. */
  readonly dir?: string;
}

/** The container's CPU limit and its use since the previous reading (left out on the first one). */
export interface CgroupCpu {
  /** The limit in CPUs, rounded to a tenth (at least 0.1). */
  readonly cpus: number;
  readonly cpuPct?: number;
}

/** CPUs from `cpu.max` (`200000 100000` → 2), undefined when unlimited (`max …`) or malformed. */
export function parseCpuMax(text: string): number | undefined {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(text.trim());
  if (!match) return undefined;
  const [quota, period] = [Number(match[1]), Number(match[2])];
  if (!(quota > 0 && period > 0)) return undefined;
  return quota / period;
}

/** A number field of a cgroup key-value file (`usage_usec 123` in `cpu.stat`), or undefined. */
export function statField(text: string, field: string): number | undefined {
  const match = new RegExp(`^${field}\\s+(\\d+)\\s*$`, 'm').exec(text);
  return match ? Number(match[1]) : undefined;
}

/** A byte count file (`memory.current`, `memory.max`), undefined for `max` or anything not a positive number. */
export function parseBytes(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 ? value : undefined;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

export class CgroupStats {
  readonly #deps: CgroupDeps;
  readonly #dir: string;
  #last: { at: number; usage: number } | undefined;

  constructor(deps: CgroupDeps) {
    this.#deps = deps;
    this.#dir = deps.dir ?? CGROUP_DIR;
  }

  /** Takes the first CPU reading, so the next one has a delta; never rejects. */
  async prime(): Promise<void> {
    const usage = await this.#usage();
    if (usage !== undefined) this.#last = { at: this.#deps.clock.now(), usage };
  }

  /** The CPU limit and the use against it since the previous reading; undefined when not limited or unreadable. */
  async cpu(): Promise<CgroupCpu | undefined> {
    const limit = await this.#read('cpu.max', parseCpuMax);
    if (limit === undefined) return undefined;
    const cpus = Math.max(0.1, tenth(limit));
    const usage = await this.#usage();
    if (usage === undefined) return { cpus };
    const now = this.#deps.clock.now();
    const before = this.#last;
    this.#last = { at: now, usage };
    if (!before || now <= before.at || usage < before.usage) return { cpus };
    const share = (usage - before.usage) / ((now - before.at) * 1000 * limit);
    return { cpus, cpuPct: percent(share, 1) };
  }

  /** Memory in use as a percentage of the limit; undefined when not limited or unreadable. */
  async memory(): Promise<number | undefined> {
    const max = await this.#read('memory.max', parseBytes);
    const current = max === undefined ? undefined : await this.#read('memory.current', parseBytes);
    if (max === undefined || current === undefined) return undefined;
    const cache = (await this.#read('memory.stat', (text) => statField(text, 'inactive_file'))) ?? 0;
    return percent(Math.max(0, current - cache), max);
  }

  #usage(): Promise<number | undefined> {
    return this.#read('cpu.stat', (text) => statField(text, 'usage_usec'));
  }

  async #read<T>(file: string, parse: (text: string) => T | undefined): Promise<T | undefined> {
    try {
      return parse(await this.#deps.readFile(`${this.#dir}/${file}`));
    } catch {
      return undefined;
    }
  }
}
