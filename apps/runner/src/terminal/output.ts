import { TERMINAL_DATA_MAX_BYTES } from '@mwc/shared/runner-protocol';
import type { Timers } from '../system/time.ts';

/**
 * A terminal's output on its way to the link: batched (sent 16 ms after the first byte, or at once from 32 KB), in
 * frames of at most `TERMINAL_DATA_MAX_BYTES`, and paused while the link's send buffer is high: the PTY stops being read
 * above 1 MB queued and resumes once it is down to 256 KB (looked at every 50 ms), so a `cat` of a big file cannot fill
 * the runner's memory.
 */

export const OUTPUT_DELAY_MS = 16;
export const OUTPUT_BATCH_BYTES = 32 * 1024;
export const BUFFER_HIGH_BYTES = 1024 * 1024;
export const BUFFER_LOW_BYTES = 256 * 1024;
export const BUFFER_POLL_MS = 50;

export interface OutputDeps {
  readonly timers: Timers;
  /** Sends one piece of output, as base64. */
  send(data: string): void;
  /** The bytes waiting in the link's send buffer. */
  buffered(): number;
  /** Stops and starts reading the PTY. */
  pause(): void;
  resume(): void;
}

export class OutputBatcher {
  readonly #deps: OutputDeps;
  #chunks: Buffer[] = [];
  #size = 0;
  #timer: unknown;
  #poll: unknown;
  #paused = false;
  #closed = false;

  constructor(deps: OutputDeps) {
    this.#deps = deps;
  }

  /** True while the PTY is paused for the link. */
  get paused(): boolean {
    return this.#paused;
  }

  /** Output the PTY printed. */
  push(data: Buffer): void {
    if (this.#closed || data.length === 0) return;
    this.#chunks.push(data);
    this.#size += data.length;
    if (this.#size >= OUTPUT_BATCH_BYTES) this.flush();
    else this.#timer ??= this.#deps.timers.setTimeout(() => this.flush(), OUTPUT_DELAY_MS);
  }

  /** Sends what is waiting now. */
  flush(): void {
    this.#deps.timers.clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#size === 0) return;
    const all = Buffer.concat(this.#chunks);
    this.#chunks = [];
    this.#size = 0;
    for (let offset = 0; offset < all.length; offset += TERMINAL_DATA_MAX_BYTES) {
      this.#deps.send(all.subarray(offset, offset + TERMINAL_DATA_MAX_BYTES).toString('base64'));
    }
    if (!this.#paused && this.#deps.buffered() > BUFFER_HIGH_BYTES) {
      this.#paused = true;
      this.#deps.pause();
      this.#watch();
    }
  }

  /** Sends what is left and stops (the shell ended). */
  close(): void {
    this.flush();
    this.#closed = true;
    this.#deps.timers.clearTimeout(this.#poll);
  }

  #watch(): void {
    this.#poll = this.#deps.timers.setTimeout(() => {
      if (this.#deps.buffered() > BUFFER_LOW_BYTES) {
        this.#watch();
        return;
      }
      this.#paused = false;
      this.#deps.resume();
    }, BUFFER_POLL_MS);
  }
}
