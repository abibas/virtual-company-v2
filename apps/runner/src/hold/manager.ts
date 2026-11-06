import { DEVBOX_KEEPALIVE_REFRESH_MS, type HoldSource } from '@mwc/shared/runner-protocol';
import type { Log } from '../log.ts';
import type { Clock, Timers } from '../system/time.ts';
import type { HoldDriver } from './driver.ts';

/**
 * The runner's hold (docs/runner-protocol.md, "Hold and power"): the machine is held until the later of the server's
 * `machine.hold {until}` and the runner's own hold while runs are live (a rolling 20 minutes, so it holds through a
 * server outage). Every change goes to the driver at once; while held, the driver is refreshed every 5 minutes, and
 * the server's hold is released when its time comes. After each change of what the driver guarantees, or of what set
 * it, the manager reports `hold.state {until, source}`. Changes run one at a time, in order.
 */

/** The runner's own hold while runs are live, renewed at each refresh. */
export const LIVE_RUNS_HOLD_MS = 20 * 60_000;

/** Node's longest timer; a later end is checked again at the next refresh. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** `hold.state` without its `type`. */
export interface HoldReport {
  readonly until: number | null;
  readonly source: HoldSource;
}

export interface HoldManagerDeps {
  readonly driver: HoldDriver;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly log: Log;
  /** Called after each change: the runner sends it as `hold.state` when connected. */
  report(state: HoldReport): void;
  /** Between two refreshes while held; `DEVBOX_KEEPALIVE_REFRESH_MS` by default. */
  readonly refreshMs?: number;
}

type Step = 'change' | 'refresh';

export class HoldManager {
  readonly #deps: HoldManagerDeps;
  readonly #refreshMs: number;
  #serverUntil: number | null = null;
  #liveRuns = 0;
  #state: HoldReport = { until: null, source: 'server' };
  #held = false;
  #closed = false;
  #chain: Promise<void> = Promise.resolve();
  #refreshTimer: unknown;
  #expiryTimer: unknown;

  constructor(deps: HoldManagerDeps) {
    this.#deps = deps;
    this.#refreshMs = deps.refreshMs ?? DEVBOX_KEEPALIVE_REFRESH_MS;
  }

  /** The last state reported (`hold.state` after each resync). */
  get state(): HoldReport {
    return this.#state;
  }

  get liveRuns(): number {
    return this.#liveRuns;
  }

  /** The server's hold (`machine.hold`): until a time, or released with null. Resolves once applied. */
  setServerHold(until: number | null): Promise<void> {
    this.#serverUntil = until;
    return this.#enqueue('server', 'change');
  }

  /** How many runs are live (S5 calls it): the hold changes when the first starts and when the last ends. */
  setLiveRuns(count: number): Promise<void> {
    const next = Math.max(0, Math.floor(count));
    const changed = this.#liveRuns > 0 !== next > 0;
    this.#liveRuns = next;
    return changed ? this.#enqueue('live_runs', 'change') : this.#chain;
  }

  /** Looks again now, as after the machine slept: an ended server hold is released, a held driver refreshed. */
  refresh(): Promise<void> {
    return this.#enqueue(this.#dominant(), this.#held ? 'refresh' : 'change');
  }

  /** Stops the timers, waits for the change in flight and releases the driver (the runner's exit). */
  async close(): Promise<void> {
    this.#closed = true;
    this.#clearTimers();
    await this.#chain;
    await this.#deps.driver.close();
  }

  #dominant(): HoldSource {
    return this.#liveRuns > 0 ? 'live_runs' : 'server';
  }

  #enqueue(source: HoldSource, step: Step): Promise<void> {
    this.#chain = this.#chain
      .then(() => this.#apply(source, step))
      .catch((error: unknown) => this.#deps.log.error('the hold could not be applied', { error }));
    return this.#chain;
  }

  /** The end the machine is held to now, or null. */
  #target(now: number): number | null {
    const server = this.#serverUntil !== null && this.#serverUntil > now ? this.#serverUntil : null;
    const live = this.#liveRuns > 0 ? now + LIVE_RUNS_HOLD_MS : null;
    if (server === null) return live;
    return live === null ? server : Math.max(server, live);
  }

  async #apply(source: HoldSource, step: Step): Promise<void> {
    if (this.#closed) return;
    const { driver } = this.#deps;
    const now = this.#deps.clock.now();
    if (this.#serverUntil !== null && this.#serverUntil <= now) this.#serverUntil = null;
    const target = this.#target(now);
    let until: number | null;
    if (target === null) until = await driver.apply(null);
    else until = step === 'refresh' ? await driver.refresh(target) : await driver.apply(target);
    this.#held = target !== null;
    this.#schedule(now);
    if (until !== this.#state.until || source !== this.#state.source) {
      this.#state = { until, source };
      this.#deps.report(this.#state);
    }
  }

  /** While held: the refresh cadence (kept across changes) and the server hold's end. Released: no timers. */
  #schedule(now: number): void {
    const { timers } = this.#deps;
    timers.clearTimeout(this.#expiryTimer);
    this.#expiryTimer = undefined;
    if (!this.#held) {
      this.#clearTimers();
      return;
    }
    if (this.#refreshTimer === undefined) {
      this.#refreshTimer = timers.setTimeout(() => {
        this.#refreshTimer = undefined;
        void this.#enqueue(this.#dominant(), 'refresh');
      }, this.#refreshMs);
    }
    if (this.#serverUntil !== null) {
      this.#expiryTimer = timers.setTimeout(
        () => {
          this.#expiryTimer = undefined;
          void this.#enqueue('server', 'change');
        },
        Math.min(MAX_TIMER_MS, this.#serverUntil - now),
      );
    }
  }

  #clearTimers(): void {
    this.#deps.timers.clearTimeout(this.#refreshTimer);
    this.#deps.timers.clearTimeout(this.#expiryTimer);
    this.#refreshTimer = undefined;
    this.#expiryTimer = undefined;
  }
}
