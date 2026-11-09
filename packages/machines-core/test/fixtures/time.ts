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
 * Monotonic time the test moves by hand, and timers keyed by it: `advance` fires each timer that comes due, in order,
 * letting its work run.
 */
export class FakeTime {
  mono = 0;
  #pending: Pending[] = [];
  #nextId = 1;

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

  /** Moves the clock forward by `ms`, firing every timer that comes due on the way and letting its work run. */
  async advance(ms: number): Promise<void> {
    const end = this.mono + ms;
    for (;;) {
      const due = this.#pending
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.mono = due.at;
      this.#pending = this.#pending.filter((timer) => timer !== due);
      due.callback();
      await settle();
    }
    this.mono = end;
    await settle();
  }
}
