import type { Clock, Timers } from '../../src/system/time.ts';

/** Lets promises and I/O callbacks that are already due run (a few turns of the event loop). */
export async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

interface Pending {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
}

/**
 * Time the test moves by hand: a wall clock, a monotonic clock and timers keyed by the monotonic one. `advance`
 * moves both clocks and fires each timer that comes due, in order; `sleep` moves only the wall clock, as a Mac that
 * slept (timers do not fire and awake time does not grow). Sockets stay real.
 */
export class FakeTime implements Clock, Timers {
  wall: number;
  mono = 0;
  #pending: Pending[] = [];
  #nextId = 1;

  constructor(wall = Date.UTC(2026, 10, 6, 9, 0, 0)) {
    this.wall = wall;
  }

  now(): number {
    return this.wall;
  }

  monotonic(): number {
    return this.mono;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.#nextId++;
    this.#pending.push({ id, at: this.mono + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#pending = this.#pending.filter((timer) => timer.id !== handle);
  }

  /** The delays of the pending timers from now, soonest first. */
  get pending(): number[] {
    return this.#pending.map((timer) => timer.at - this.mono).sort((a, b) => a - b);
  }

  /** Moves both clocks forward by `ms`, firing every timer that comes due on the way and letting its work run. */
  async advance(ms: number): Promise<void> {
    const end = this.mono + ms;
    for (;;) {
      const due = this.#pending
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.wall += due.at - this.mono;
      this.mono = due.at;
      this.#pending = this.#pending.filter((timer) => timer !== due);
      due.callback();
      await settle();
    }
    this.wall += end - this.mono;
    this.mono = end;
    await settle();
  }

  /** The machine sleeps for `ms`: the wall clock moves, the monotonic clock and the timers stand still. */
  sleep(ms: number): void {
    this.wall += ms;
  }
}
