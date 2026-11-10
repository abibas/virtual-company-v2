import type { RolloutFs } from '../rollout.ts';

/**
 * One session file followed as it grows (docs/harness.md, "Codex subagents"): each read takes only the bytes written
 * since the last one, from a byte offset, and gives the whole lines among them. A last line still being written stays in
 * the file for the next read (the offset stops after the last newline), so a line is never cut or read twice. A line
 * longer than `FOLLOW_READ_BYTES` is skipped whole: Codex keeps the lines that matter here (activities, calls, a
 * command's end with its output cut to 64 KiB) far smaller. No process, no watcher: the caller polls.
 */

/** The most bytes one read takes from a file, and so the longest line kept. */
export const FOLLOW_READ_BYTES = 1 << 20;

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

/** What one read gave: its whole lines, without their line ends, and how many bytes it read from the file. */
export interface FollowedLines {
  readonly lines: readonly string[];
  readonly bytes: number;
}

const NOTHING: FollowedLines = { lines: [], bytes: 0 };

export class FileFollower {
  readonly path: string;
  readonly #fs: RolloutFs;
  readonly #longest: number;
  #offset: number;
  /** Inside a line too long to keep: its rest is dropped up to its newline. */
  #skipping = false;

  /** Follows `path` from byte `offset`; a line over `longest` bytes is skipped. */
  constructor(fs: RolloutFs, path: string, offset: number, longest = FOLLOW_READ_BYTES) {
    this.#fs = fs;
    this.path = path;
    this.#offset = offset;
    this.#longest = longest;
  }

  /** Where the next read starts. */
  get offset(): number {
    return this.#offset;
  }

  /**
   * The whole lines written since the last read, reading at most `bytes` bytes (a read cut short by a smaller `bytes`
   * waits for the next one); none when the file cannot be read.
   */
  read(bytes: number): FollowedLines {
    if (bytes <= 0) return NOTHING;
    const got = this.#fs.readAt(this.path, this.#offset, bytes);
    if (got === undefined) return NOTHING;
    // A file that shrank was replaced: follow the new one from its start.
    if (got.size < this.#offset) this.#offset = 0;
    const { data } = got;
    const end = data.lastIndexOf(NEWLINE);
    if (end < 0) {
      if (data.length >= this.#longest) {
        // One line longer than the longest kept: drop what was read of it.
        this.#offset += data.length;
        this.#skipping = true;
      }
      return { lines: [], bytes: data.length };
    }
    this.#offset += end + 1;
    const lines = decoder.decode(data.subarray(0, end)).split('\n');
    if (this.#skipping) {
      lines.shift();
      this.#skipping = false;
    }
    const whole = lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
    return { lines: whole, bytes: data.length };
  }
}
