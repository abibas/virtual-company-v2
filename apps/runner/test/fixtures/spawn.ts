import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildLike, KillGroup, Spawn, SpawnOptions } from '../../src/system/process.ts';

/** A child process that does what the test says: print and exit, fail to start, or run until killed. */
export class FakeChild extends EventEmitter implements ChildLike {
  readonly pid: number;
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
  /** The signals `kill` got, in order. */
  readonly signals: NodeJS.Signals[] = [];
  exited = false;
  /** Whether `kill` ends it (true by default). */
  dies = true;

  constructor(pid: number, piped: boolean, errPiped = false) {
    super();
    this.pid = pid;
    this.stdout = piped ? new PassThrough() : null;
    this.stderr = errPiped ? new PassThrough() : null;
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

  /** Prints `text` on its standard error (piped only). */
  printErr(text: string): void {
    this.stderr?.write(text);
  }

  /** Exits: `exit` at once, `close` once its output (standard output and error) is read to the end. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', code, signal);
    const streams = [this.stdout, this.stderr].filter((stream) => stream !== null);
    let open = streams.length;
    if (open === 0) {
      this.emit('close', code, signal);
      return;
    }
    for (const stream of streams) {
      stream.once('end', () => {
        open--;
        if (open === 0) this.emit('close', code, signal);
      });
      stream.end();
    }
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

  /** The signals `killGroup` sent, in order, by process group. */
  readonly groupKills: { readonly pid: number; readonly signal: NodeJS.Signals }[] = [];

  readonly spawn: Spawn = (file, args, options) => {
    if (this.throwsFor.has(file)) throw new Error(`cannot start ${file}`);
    const pid = 4000 + this.calls.length;
    const child = new FakeChild(pid, options.stdio[1] === 'pipe', options.stdio[2] === 'pipe');
    this.calls.push({ file, args: [...args], options, child });
    const behaviour = this.#behaviours.get(file);
    if (behaviour) setImmediate(() => behaviour(child, args));
    return child;
  };

  of(file: string): SpawnCall[] {
    return this.calls.filter((call) => call.file === file);
  }

  /** Signals the group of a child it started: recorded, and the child ends unless it does not die (SIGKILL always). */
  readonly killGroup: KillGroup = (pid, signal) => {
    this.groupKills.push({ pid, signal });
    const child = this.calls.find((call) => call.child.pid === pid)?.child;
    if (child === undefined) return;
    child.signals.push(signal);
    if (child.dies || signal === 'SIGKILL') setImmediate(() => child.exit(null, signal));
  };
}
