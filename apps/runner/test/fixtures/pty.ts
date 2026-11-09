import { constants } from 'node:os';
import type { PtyOptions, PtyProcess, PtySpawn } from '../../src/terminal/loader.ts';

/**
 * A PTY that does what the test says, never a real one: it records what was written, every resize and signal, prints
 * what the test gives it, and exits when the test says, or when signalled (a moment later, as node-pty reports it),
 * unless `dies` is false (a shell that ignores SIGHUP).
 */
export class FakePty implements PtyProcess {
  readonly pid: number;
  readonly written: Buffer[] = [];
  readonly sizes: (readonly [number, number])[] = [];
  readonly signals: string[] = [];
  paused = false;
  /** Whether a signal ends it (true by default). */
  dies = true;
  /** Thrown by `kill` and `resize`, as by a PTY whose shell is gone. */
  failing: Error | undefined;
  #data: ((data: Buffer | string) => void) | undefined;
  #exit: ((exit: { exitCode: number; signal?: number }) => void) | undefined;

  constructor(pid: number) {
    this.pid = pid;
  }

  onData(listener: (data: Buffer | string) => void): void {
    this.#data = listener;
  }

  onExit(listener: (exit: { exitCode: number; signal?: number }) => void): void {
    this.#exit = listener;
  }

  write(data: Buffer | string): void {
    this.written.push(Buffer.from(data));
  }

  resize(cols: number, rows: number): void {
    if (this.failing) throw this.failing;
    this.sizes.push([cols, rows]);
  }

  kill(signal = 'SIGHUP'): void {
    if (this.failing) throw this.failing;
    this.signals.push(signal);
    const number = constants.signals[signal as keyof typeof constants.signals];
    if (this.dies) setImmediate(() => this.exit(0, number));
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** The shell prints (a string as node-pty gives without `encoding: null`, or bytes). */
  print(data: Buffer | string): void {
    this.#data?.(data);
  }

  /** The shell ends with a code, or by a signal's number. */
  exit(exitCode: number, signal?: number): void {
    this.#exit?.(signal === undefined ? { exitCode } : { exitCode, signal });
  }

  /** Everything written to it, as text. */
  get input(): string {
    return Buffer.concat(this.written).toString();
  }
}

export interface Spawned {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: PtyOptions;
  readonly pty: FakePty;
}

/** The PTY's `spawn`: each call makes a `FakePty` (or throws `fails`), recorded in `spawned`. */
export class FakePtySpawner {
  readonly spawned: Spawned[] = [];
  fails: Error | undefined;
  #pid = 7000;

  readonly spawn: PtySpawn = (file, args, options) => {
    if (this.fails) throw this.fails;
    const pty = new FakePty(this.#pid++);
    this.spawned.push({ file, args, options, pty });
    return pty;
  };

  /** The PTY of the n-th spawn (the last by default). */
  pty(index = -1): FakePty {
    const spawned = this.spawned.at(index);
    if (!spawned) throw new Error('No terminal was spawned');
    return spawned.pty;
  }
}
