import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildLike, Spawn, SpawnOptions } from '../../src/system/process.ts';

/** A child process that does what the test says: print and exit, fail to start, or run until killed. */
export class FakeChild extends EventEmitter implements ChildLike {
  readonly pid: number;
  readonly stdout: PassThrough | null;
  /** The signals `kill` got, in order. */
  readonly signals: NodeJS.Signals[] = [];
  exited = false;
  /** Whether `kill` ends it (true by default). */
  dies = true;

  constructor(pid: number, piped: boolean) {
    super();
    this.pid = pid;
    this.stdout = piped ? new PassThrough() : null;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (this.dies) setImmediate(() => this.exit(null, signal));
    return true;
  }

  /** Prints `stdout` and exits with `code`. */
  finish(stdout = '', code = 0): void {
    this.stdout?.write(stdout);
    this.exit(code);
  }

  /** Exits: `exit` at once, `close` once its output is read to the end. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', code, signal);
    if (!this.stdout) {
      this.emit('close', code, signal);
      return;
    }
    this.stdout.once('end', () => this.emit('close', code, signal));
    this.stdout.end();
  }

  /** Fails as a missing program does. */
  fail(message = 'spawn ENOENT'): void {
    this.emit('error', new Error(message));
  }
}

export interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
  readonly child: FakeChild;
}

type Behaviour = (child: FakeChild, args: readonly string[]) => void;

/** A `spawn` that starts no process: it records each call and runs the test's behaviour for the program. */
export class FakeSpawn {
  readonly calls: SpawnCall[] = [];
  readonly #behaviours = new Map<string, Behaviour>();
  /** Throw from `spawn` itself for these programs. */
  readonly throwsFor = new Set<string>();

  /** What `file` does once started (on the next turn); a program without one runs until killed. */
  when(file: string, behaviour: Behaviour): this {
    this.#behaviours.set(file, behaviour);
    return this;
  }

  readonly spawn: Spawn = (file, args, options) => {
    if (this.throwsFor.has(file)) throw new Error(`cannot start ${file}`);
    const child = new FakeChild(4000 + this.calls.length, options.stdio[1] === 'pipe');
    this.calls.push({ file, args: [...args], options, child });
    const behaviour = this.#behaviours.get(file);
    if (behaviour) setImmediate(() => behaviour(child, args));
    return child;
  };

  of(file: string): SpawnCall[] {
    return this.calls.filter((call) => call.file === file);
  }
}
