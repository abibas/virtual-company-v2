/**
 * The runner's two clocks and its timers, injected everywhere so tests drive time by hand (`test/fixtures/time.ts`).
 * The wall clock is what frames carry; the monotonic one measures awake time: on macOS and Linux it stops while the
 * machine sleeps, so the wall clock running ahead of it is how a sleep shows.
 */

export interface Clock {
  /** Wall time, milliseconds since the epoch. */
  now(): number;
  /** Monotonic milliseconds from an arbitrary start; they do not advance while the machine sleeps. */
  monotonic(): number;
}

/** Timers keyed by monotonic time, as Node's are; a handle is whatever `setTimeout` returned. */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
};

/** Node's timers, kept referenced: a reconnect waiting in its backoff keeps the daemon alive. */
export const SYSTEM_TIMERS: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
