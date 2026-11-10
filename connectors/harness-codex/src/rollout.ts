import { join } from 'node:path';
import { type CodexReading, scanReading } from './reading.ts';

/**
 * Codex's session file of a thread (docs/harness.md, "Codex's context reading"): `$CODEX_HOME/sessions/YYYY/MM/DD/
 * rollout-<time>-<thread id>.jsonl`, in the folder of the day the thread began; `codex exec resume` and the TUI's
 * `resume` append to it, `codex exec fork` starts a new thread with its own file. It only grows (a long thread's is
 * megabytes, a line can be hundreds of kilobytes), so it is read from its end: 1 MiB, then four times more until the
 * reading is whole or 16 MiB were read. While a turn runs, the subagents' files are followed from an offset
 * (`follow/`). Synchronous file calls only, no process.
 */

/** The file calls the reading needs; the runner gives Node's (`turns/files.ts`), tests a fake. */
export interface RolloutFs {
  /** A folder's entry names; empty when it is missing or cannot be read. */
  list(dir: string): readonly string[];
  /** The last `bytes` bytes of a file as UTF-8, with the file's size; undefined when it cannot be read. */
  tail(path: string, bytes: number): { readonly text: string; readonly size: number } | undefined;
  /** At most `bytes` bytes of a file from byte `offset`, with the file's size; undefined when it cannot be read. */
  readAt(
    path: string,
    offset: number,
    bytes: number,
  ): { readonly data: Uint8Array; readonly size: number } | undefined;
}

/** Codex's sessions folder in its home folder. */
export const SESSIONS_DIR = 'sessions';
/** The first read from the file's end, and the most read. */
export const ROLLOUT_FIRST_READ = 1 << 20;
export const ROLLOUT_MAX_READ = 16 << 20;

const YEAR = /^\d{4}$/;
const TWO_DIGITS = /^\d{2}$/;

/** A folder's dated entries (years, months or days), newest first. */
const newest = (fs: RolloutFs, dir: string, pattern: RegExp): string[] =>
  fs
    .list(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .reverse()
    .map((name) => join(dir, name));

/**
 * The thread's session file in `home`, looked for from the newest day back, in at most `days` day folders (a thread
 * that began during this turn is in the newest one or two); undefined when there is none.
 */
export function findRollout(
  fs: RolloutFs,
  home: string,
  threadId: string,
  days = Infinity,
): string | undefined {
  const suffix = `-${threadId}.jsonl`;
  let left = days;
  for (const year of newest(fs, join(home, SESSIONS_DIR), YEAR)) {
    for (const month of newest(fs, year, TWO_DIGITS)) {
      for (const day of newest(fs, month, TWO_DIGITS)) {
        if (left-- <= 0) return undefined;
        const name = fs.list(day).find((entry) => entry.startsWith('rollout-') && entry.endsWith(suffix));
        if (name !== undefined) return join(day, name);
      }
    }
  }
  return undefined;
}

/** The thread's last reading in `home`; undefined when its file is missing, unreadable or has none yet. */
export function readRollout(fs: RolloutFs, home: string, threadId: string): CodexReading | undefined {
  const path = findRollout(fs, home, threadId);
  if (path === undefined) return undefined;
  for (let bytes = ROLLOUT_FIRST_READ; ; bytes *= 4) {
    const tail = fs.tail(path, bytes);
    if (tail === undefined) return undefined;
    const all = tail.size <= bytes;
    const lines = tail.text.split('\n');
    // A read that starts inside the file starts inside a line.
    if (!all) lines.shift();
    const { reading, whole } = scanReading(lines);
    if (whole || all || bytes >= ROLLOUT_MAX_READ) return reading;
  }
}
