import type { MachineSample } from '@mwc/shared/machines';
import type { Log } from '../system/log.ts';
import type { Clock } from '../system/time.ts';
import type { CgroupStats } from './cgroup.ts';
import { type CpuTimes, type CpuTotals, cpuPercent, cpuTotals } from './cpu.ts';
import { percent } from './memory.ts';

/**
 * The machine's sample, taken once a minute and sent in the next heartbeat (`MachineSample`): loads, CPU use since the
 * last sample, cores, memory, the disk of the home folder, uptime and live runs. Everything comes from Node's `os` and
 * `fs.statfs`; only macOS's memory reading starts a process (`memory.ts`). In a container its cgroup's limits, when it
 * has them, replace the CPUs, the CPU use and the memory (`cgroup.ts`).
 */

/** What the sampler reads of Node's `os`. */
export interface SamplerOs {
  loadavg(): number[];
  cpus(): readonly { readonly times: CpuTimes }[];
  uptime(): number;
}

/** What it reads of `fs.statfs`: block size and counts. */
export interface DiskStats {
  readonly bsize: number;
  readonly blocks: number;
  readonly bfree: number;
}

export interface SamplerDeps {
  readonly os: SamplerOs;
  readonly statfs: (path: string) => Promise<DiskStats>;
  /** The folder whose disk is measured: the runner user's home. */
  readonly home: string;
  /** Memory in use, a percentage (`createMemoryReader`). */
  readonly memory: () => Promise<number>;
  /** The container's own limits and use (only in a container). */
  readonly cgroup?: CgroupStats;
  readonly clock: Clock;
  readonly log: Log;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const load = (value: number | undefined) =>
  Number.isFinite(value) && (value as number) > 0 ? round2(value as number) : 0;

export class Sampler {
  readonly #deps: SamplerDeps;
  #cpu: CpuTotals;
  #diskWarned = false;

  constructor(deps: SamplerDeps) {
    this.#deps = deps;
    this.#cpu = cpuTotals(deps.os.cpus());
    void deps.cgroup?.prime();
  }

  /** The 1-minute load average, for every heartbeat. */
  load1(): number {
    return load(this.#deps.os.loadavg()[0]);
  }

  /** A sample now; CPU use is measured since the previous sample (or since the sampler was made). */
  async sample(liveRuns: number): Promise<MachineSample> {
    const { os } = this.#deps;
    const [load1, load5, load15] = os.loadavg();
    const cores = os.cpus();
    const cpu = cpuTotals(cores);
    const cpuPct = cpuPercent(this.#cpu, cpu);
    this.#cpu = cpu;
    const [memPct, disk, limited] = await Promise.all([
      this.#memory(),
      this.#disk(),
      this.#deps.cgroup?.cpu(),
    ]);
    return {
      load1: load(load1),
      load5: load(load5),
      load15: load(load15),
      // The sample's CPUs are a whole number (machine_samples.cpus): a container's limit is rounded, at least 1.
      cpus: Math.max(1, limited ? Math.round(limited.cpus) : cores.length),
      cpuPct: limited?.cpuPct ?? cpuPct,
      memPct: percent(memPct, 100),
      diskUsed: disk.used,
      diskTotal: disk.total,
      uptimeS: Math.max(0, Math.floor(os.uptime())),
      liveRuns: Math.max(0, Math.floor(liveRuns)),
      at: this.#deps.clock.now(),
    };
  }

  /** Memory in use: against the container's limit when it has one, else the machine's. */
  async #memory(): Promise<number> {
    return (await this.#deps.cgroup?.memory()) ?? (await this.#deps.memory());
  }

  /** The home folder's disk in bytes: used is total less free blocks (as `df` counts it); zeros when unreadable. */
  async #disk(): Promise<{ used: number; total: number }> {
    try {
      const stats = await this.#deps.statfs(this.#deps.home);
      const total = Math.max(0, Math.floor(stats.blocks * stats.bsize));
      const free = Math.max(0, Math.floor(stats.bfree * stats.bsize));
      return { used: Math.max(0, total - free), total };
    } catch (error) {
      if (!this.#diskWarned) {
        this.#diskWarned = true;
        this.#deps.log.warn('cannot read the disk of the home folder', { home: this.#deps.home, error });
      }
      return { used: 0, total: 0 };
    }
  }
}
