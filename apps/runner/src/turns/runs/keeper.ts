import { join } from 'node:path';
import type { Timers } from '../../system/time.ts';
import { LineReader } from '../lines.ts';
import { RUN_FILES, type RunExit } from './folder.ts';

/**
 * The keeper (S5.4, docs/harness.md "Surviving restarts"): `node runner.mjs keep <run folder> -- <command> <args…>`, the
 * one process the runner starts per turn, in its own session and process group, from which it starts the harness in the
 * same group with its stdout and stderr appended to the run folder's `out` and `err` (files, not pipes, so the harness
 * never notices the runner going away). It holds the harness's stdin: the runner that started it writes commands on the
 * keeper's own stdin, and a runner that re-attached connects to `k.sock` (greeted with `{"pid":N}`, how it learns whose
 * process group to signal) and writes the same commands, one JSON line each: `{"w":"<text>"}` writes the text to the
 * harness's stdin, `{"end":true}` closes it. A runner that goes away closes its line without `end`: stdin stays open,
 * and only when no runner has been there for `KEEPER_ORPHAN_MS` does the keeper close it, so a harness waiting for more
 * messages finishes instead of waiting forever. SIGINT, SIGTERM and SIGHUP do not end the keeper (the stop ladder
 * signals the whole group; SIGKILL ends both): when the harness ends, it writes `exit.json` (`{code, signal}`, or
 * `{error}` when it could not start), closes its socket and exits.
 */

/** How long the harness's stdin stays open with no runner on the line. */
export const KEEPER_ORPHAN_MS = 10 * 60_000;

/** The usage error: not a run folder and a command. */
export const KEEPER_USAGE = 64;

/** The harness as the keeper drives it. */
export interface KeeperChild {
  readonly stdin: NodeJS.WritableStream | null;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** A runner's line to the keeper: its stdin, or a connection on `k.sock`. */
export interface KeeperLine {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'close' | 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  write?(text: string): unknown;
  destroy(): unknown;
}

/** The process around `runKeeper`, injected so tests drive it in-process (`keeper-io.ts` is the real one). */
export interface KeeperIo {
  /** The arguments after `keep`: the run folder, `--`, the command and its arguments. */
  readonly argv: readonly string[];
  readonly pid: number;
  /** The keeper's own stdin: the line of the runner that started it. */
  readonly stdin: KeeperLine;
  /** Starts the harness in the keeper's group with its stdin piped and stdout and stderr on these descriptors. */
  spawn(command: string, args: readonly string[], out: number, err: number): KeeperChild;
  openAppend(path: string): number;
  close(fd: number): void;
  /** Listens on a Unix socket (a stale one removed first); each connection goes to `connected`. */
  listen(path: string, connected: (line: KeeperLine) => void): { close(): void };
  /** Writes a file whole (a temporary file renamed over it). */
  writeFile(path: string, text: string): void;
  onSignal(signal: NodeJS.Signals, handler: () => void): void;
  readonly timers: Timers;
}

/** The run folder, the command and its arguments; undefined for anything else. */
export function keeperArgs(argv: readonly string[]) {
  const [dir, dashes, command, ...args] = argv;
  if (dir === undefined || dashes !== '--' || command === undefined) return undefined;
  return { dir, command, args };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The harness's stdin: written, closed once, and closed by itself when no runner is there for long. */
class HeldStdin {
  readonly #stdin: NodeJS.WritableStream | null;
  readonly #timers: Timers;
  #open = true;
  #lines = 0;
  #orphan: unknown;

  constructor(stdin: NodeJS.WritableStream | null, timers: Timers) {
    this.#stdin = stdin;
    this.#timers = timers;
    stdin?.on('error', () => {
      // A harness that stopped reading closes the pipe: its exit says what happened.
    });
  }

  /** One command line from a runner. */
  command(text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    const command = (value ?? {}) as { w?: unknown; end?: unknown };
    if (typeof command.w === 'string' && this.#open) this.#stdin?.write(command.w);
    else if (command.end === true) this.close();
  }

  close(): void {
    this.#timers.clearTimeout(this.#orphan);
    if (!this.#open) return;
    this.#open = false;
    this.#stdin?.end();
  }

  /** A runner's line opened. */
  joined(): void {
    this.#lines++;
    this.#timers.clearTimeout(this.#orphan);
    this.#orphan = undefined;
  }

  /** A runner's line closed: with none left, stdin closes after `KEEPER_ORPHAN_MS`. */
  left(): void {
    this.#lines--;
    if (this.#lines > 0 || !this.#open) return;
    this.#orphan = this.#timers.setTimeout(() => this.close(), KEEPER_ORPHAN_MS);
  }
}

/** Feeds a runner's line into the held stdin, one command a line, until it closes. */
function follow(line: KeeperLine, stdin: HeldStdin): void {
  const reader = new LineReader();
  let open = true;
  stdin.joined();
  const closed = () => {
    if (!open) return;
    open = false;
    stdin.left();
  };
  line.on('data', (chunk) => {
    for (const text of reader.push(chunk)) stdin.command(text);
  });
  line.on('error', closed);
  line.on('end', closed);
  line.on('close', closed);
}

/** Runs the keeper (see above); resolves to its exit code once the harness ended and everything is closed. */
export function runKeeper(io: KeeperIo): Promise<number> {
  const parsed = keeperArgs(io.argv);
  if (parsed === undefined) return Promise.resolve(KEEPER_USAGE);
  const { dir, command, args } = parsed;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) io.onSignal(signal, () => {});
  const out = io.openAppend(join(dir, RUN_FILES.out));
  const err = io.openAppend(join(dir, RUN_FILES.err));
  const lines = new Set<KeeperLine>();
  return new Promise((resolve) => {
    let child: KeeperChild | undefined;
    let server: { close(): void } | undefined;
    let done = false;
    const finish = (exit: RunExit) => {
      if (done) return;
      done = true;
      io.writeFile(join(dir, RUN_FILES.exit), JSON.stringify(exit));
      held?.close();
      server?.close();
      for (const line of lines) line.destroy();
      io.stdin.destroy();
      resolve(0);
    };
    let held: HeldStdin | undefined;
    try {
      child = io.spawn(command, args, out, err);
    } catch (error) {
      finish({ code: null, signal: null, error: messageOf(error) });
      return;
    } finally {
      io.close(out);
      io.close(err);
    }
    held = new HeldStdin(child.stdin, io.timers);
    const stdin = held;
    child.once('error', (error) => finish({ code: null, signal: null, error: messageOf(error) }));
    child.once('exit', (code, signal) => finish({ code, signal }));
    follow(io.stdin, stdin);
    server = io.listen(join(dir, RUN_FILES.socket), (line) => {
      if (done) {
        line.destroy();
        return;
      }
      lines.add(line);
      line.on('close', () => lines.delete(line));
      line.write?.(`${JSON.stringify({ pid: io.pid })}\n`);
      follow(line, stdin);
    });
  });
}
