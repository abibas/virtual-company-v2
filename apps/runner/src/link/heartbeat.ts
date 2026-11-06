import type { MachineSample } from '@mwc/shared/machines';
import { MACHINE_SAMPLE_MS, RUNNER_HEARTBEAT_MS, type RunnerHeartbeat } from '@mwc/shared/runner-protocol';
import type { Log } from '../log.ts';
import type { Clock } from '../system/time.ts';

/**
 * The heartbeats of a connection, one every 20 s: awake time from the monotonic clock (it stops while the machine
 * sleeps), the 1-minute load, and a sample once a minute by the wall clock (so one `sysctl` start a minute at most on
 * the Mac). A gap of more than two intervals of wall time between two heartbeats means the machine slept: the runner
 * then sends a resync before the heartbeat.
 */

/** A wall-clock gap over this between two heartbeats means the machine slept. */
export const SLEEP_GAP_MS = 2 * RUNNER_HEARTBEAT_MS;

export interface HeartbeatDeps {
  readonly clock: Clock;
  readonly sampler: { load1(): number; sample(liveRuns: number): Promise<MachineSample> };
  /** How many runs are live, for the sample. */
  readonly liveRuns: () => number;
  readonly log: Log;
}

export interface NextHeartbeat {
  readonly frame: RunnerHeartbeat;
  /** The wall time since the previous heartbeat was over `SLEEP_GAP_MS`. */
  readonly slept: boolean;
  /** That wall time, 0 for the first heartbeat of a connection. */
  readonly gapMs: number;
}

export class Heartbeats {
  readonly #deps: HeartbeatDeps;
  readonly #startedAt: number;
  #lastBeatAt: number | undefined;
  #lastSampleAt: number | undefined;

  constructor(deps: HeartbeatDeps) {
    this.#deps = deps;
    this.#startedAt = deps.clock.monotonic();
  }

  /** Monotonic milliseconds since the runner started. */
  awakeMs(): number {
    return Math.max(0, Math.round(this.#deps.clock.monotonic() - this.#startedAt));
  }

  /** A new connection: its first heartbeat has no gap to measure. */
  connected(): void {
    this.#lastBeatAt = undefined;
  }

  /** The heartbeat to send now. */
  async next(): Promise<NextHeartbeat> {
    const now = this.#deps.clock.now();
    const gapMs = this.#lastBeatAt === undefined ? 0 : now - this.#lastBeatAt;
    this.#lastBeatAt = now;
    const sample = this.#sampleDue(now) ? await this.#sample(now) : undefined;
    const frame: RunnerHeartbeat = {
      type: 'runner.heartbeat',
      awakeMs: this.awakeMs(),
      load1: sample?.load1 ?? this.#deps.sampler.load1(),
      liveRuns: [],
      backlog: 0,
      now,
      ...(sample ? { sample } : {}),
    };
    return { frame, slept: gapMs > SLEEP_GAP_MS, gapMs };
  }

  #sampleDue(now: number): boolean {
    const last = this.#lastSampleAt;
    return last === undefined || now - last >= MACHINE_SAMPLE_MS || now < last;
  }

  async #sample(now: number): Promise<MachineSample | undefined> {
    this.#lastSampleAt = now;
    try {
      return await this.#deps.sampler.sample(this.#deps.liveRuns());
    } catch (error) {
      this.#deps.log.error('cannot take a sample', { error });
      return undefined;
    }
  }
}
