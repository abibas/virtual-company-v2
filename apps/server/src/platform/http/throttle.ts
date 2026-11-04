/**
 * At most one turn per key per interval, in this process's memory: a rate limit for a route a person may call
 * again and again, such as `POST /api/me/reconcile` (one turn per person every 10 seconds). It remembers at most
 * `max` keys and forgets the least recently granted first, so a flood of new keys cannot grow it without bound.
 * Each server process keeps its own, so with several processes a key gets a turn in each.
 */
export class Throttle {
  readonly #granted = new Map<string, number>();
  readonly #intervalMs: number;
  readonly #max: number;

  constructor(intervalMs: number, max: number) {
    this.#intervalMs = intervalMs;
    this.#max = max;
  }

  /**
   * Takes a turn for `key` at `nowMs`: 0 when it is granted (and recorded), else how many milliseconds are left
   * until the key's next turn (nothing is recorded). A clock that went back counts as a new turn.
   */
  take(key: string, nowMs: number): number {
    const last = this.#granted.get(key);
    if (last !== undefined && nowMs >= last && nowMs - last < this.#intervalMs) {
      return this.#intervalMs - (nowMs - last);
    }
    this.#granted.delete(key);
    this.#granted.set(key, nowMs);
    if (this.#granted.size > this.#max) this.#granted.delete(this.#granted.keys().next().value as string);
    return 0;
  }
}
