import { EventEmitter } from 'node:events';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildLike, KillGroup, Spawn, SpawnOptions } from '../../src/system/process.ts';
import { LineReader } from '../../src/turns/lines.ts';

/** The keeper command the fake harness hosts name: the fake spawn plays the keeper and the harness in one child. */
export const FAKE_KEEPER = 'mwc-keeper';

/** A stream whose writes land in a file at once (a kept harness's output). */
class FileStream extends PassThrough {
  readonly #path: string;

  constructor(path: string) {
    super();
    this.#path = path;
  }

  override write(chunk: unknown): boolean {
    appendFileSync(this.#path, chunk as string | Buffer);
    return true;
  }
}

/**
 * A child process that does what the test says: print and exit, fail to start, or run until killed. Started as a turn's
 * keeper (`FAKE_KEEPER`), it plays the keeper and the harness together: what the runner writes is decoded from the
 * keeper's commands into `input`, what it prints goes to the run folder's `out` and `err`, and its exit writes
 * `exit.json` (not after a SIGKILL, which ends the keeper too).
 */
export class FakeChild extends EventEmitter implements ChildLike {
  readonly pid: number;
  readonly stdin: PassThrough | null;
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
  /** The run folder, when it plays a keeper. */
  readonly runDir: string | undefined;
  /** What was written to its stdin, and whether stdin was closed. */
  input = '';
  inputClosed = false;
  /** The signals `kill` got, in order. */
  readonly signals: NodeJS.Signals[] = [];
  exited = false;
  /** Whether `kill` ends it (true by default). */
  dies = true;

  constructor(pid: number, piped: boolean, errPiped = false, inPiped = false, runDir?: string) {
    super();
    this.pid = pid;
    this.runDir = runDir;
    this.stdin = inPiped || runDir !== undefined ? new PassThrough() : null;
    if (runDir === undefined) {
      this.stdin?.on('data', (chunk: Buffer) => {
        this.input += chunk.toString();
      });
      this.stdin?.on('end', () => {
        this.inputClosed = true;
      });
      this.stdout = piped ? new PassThrough() : null;
      this.stderr = errPiped ? new PassThrough() : null;
      return;
    }
    const reader = new LineReader();
    this.stdin?.on('data', (chunk: Buffer) => {
      for (const line of reader.push(chunk)) this.#command(JSON.parse(line) as { w?: string; end?: true });
    });
    this.stdout = new FileStream(join(runDir, 'out'));
    this.stderr = new FileStream(join(runDir, 'err'));
  }

  /** What `released` says: the runner let go of the line without closing stdin. */
  released = false;

  #command(command: { w?: string; end?: true }): void {
    if (command.w !== undefined && !this.inputClosed) this.input += command.w;
    if (command.end) this.inputClosed = true;
  }

  /** The runner let go (its stdin ended without a close): the harness runs on. */
  unref(): void {
    this.released = true;
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
    if (this.runDir !== undefined) {
      if (signal !== 'SIGKILL')
        writeFileSync(join(this.runDir, 'exit.json'), JSON.stringify({ code, signal }));
      this.emit('exit', code, signal);
      this.emit('close', code, signal);
      return;
    }
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

  /** Fails as a missing program does (a kept harness: the keeper writes why, and exits). */
  fail(message = 'spawn ENOENT'): void {
    if (this.runDir === undefined) {
      this.emit('error', new Error(message));
      return;
    }
    writeFileSync(
      join(this.runDir, 'exit.json'),
      JSON.stringify({ code: null, signal: null, error: message }),
    );
    this.exited = true;
    this.emit('exit', 0, null);
  }
}

export interface SpawnCall {
  /** The program; for a turn's keeper, the harness it starts. */
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

  readonly spawn: Spawn = (program, programArgs, options) => {
    // A turn's keeper is recorded as the harness it starts (`<run folder> -- <command> <args…>`).
    const kept = program === FAKE_KEEPER ? programArgs : undefined;
    const file = kept === undefined ? program : (kept[2] as string);
    const args = kept === undefined ? programArgs : kept.slice(3);
    if (this.throwsFor.has(file)) throw new Error(`cannot start ${file}`);
    const pid = 4000 + this.calls.length;
    const child = new FakeChild(
      pid,
      options.stdio[1] === 'pipe',
      options.stdio[2] === 'pipe',
      options.stdio[0] === 'pipe',
      kept?.[0],
    );
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
