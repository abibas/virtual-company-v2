import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { TunnelChild, TunnelKill, TunnelSpawn, TunnelSpawnOptions } from '../../src/tunnels/process.ts';

/** A tunnel's process that does what the test says: print on its standard error, exit, fail, or run until killed. */
export class FakeChild extends EventEmitter implements TunnelChild {
  readonly pid: number;
  readonly stderr: PassThrough | null;
  /** The signals its group got, in order. */
  readonly signals: string[] = [];
  exited = false;
  /** Whether SIGTERM ends it (true by default; SIGKILL always does). */
  dies = true;

  constructor(pid: number, errPiped: boolean) {
    super();
    this.pid = pid;
    this.stderr = errPiped ? new PassThrough() : null;
  }

  /** Prints `text` on its standard error (piped only). */
  printErr(text: string): void {
    this.stderr?.write(text);
  }

  /** Exits: `close` once its standard error is read to the end. */
  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    const { stderr } = this;
    if (stderr === null) {
      this.emit('close', code, signal);
      return;
    }
    stderr.once('end', () => this.emit('close', code, signal));
    stderr.end();
  }

  /** Fails as a missing program does. */
  fail(message = 'spawn ENOENT'): void {
    this.emit('error', new Error(message));
  }
}

export interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: TunnelSpawnOptions;
  readonly child: FakeChild;
}

/** A `spawn` that starts no process: it records each call; each child runs until it is killed or told to exit. */
export class FakeSpawn {
  readonly calls: SpawnCall[] = [];
  /** Throw from `spawn` itself for these programs. */
  readonly throwsFor = new Set<string>();
  /** The signals `killGroup` sent, in order, by process group. */
  readonly groupKills: { readonly pid: number; readonly signal: string }[] = [];

  readonly spawn: TunnelSpawn = (file, args, options) => {
    if (this.throwsFor.has(file)) throw new Error(`cannot start ${file}`);
    const child = new FakeChild(4000 + this.calls.length, options.stdio[2] === 'pipe');
    this.calls.push({ file, args: [...args], options, child });
    return child;
  };

  of(file: string): SpawnCall[] {
    return this.calls.filter((call) => call.file === file);
  }

  /** Signals the group of a child it started: recorded, and the child ends unless it does not die (SIGKILL always). */
  readonly killGroup: TunnelKill = (pid, signal) => {
    this.groupKills.push({ pid, signal });
    const child = this.calls.find((call) => call.child.pid === pid)?.child;
    if (child === undefined) return;
    child.signals.push(signal);
    if (child.dies || signal === 'SIGKILL') setImmediate(() => child.exit(null, signal));
  };
}

/** A log whose messages are kept for the test to read. */
export function memoryLog() {
  const entries: { level: 'info' | 'warn'; msg: string }[] = [];
  return {
    log: {
      info: (msg: string) => void entries.push({ level: 'info', msg }),
      warn: (msg: string) => void entries.push({ level: 'warn', msg }),
    },
    messages: (level?: 'info' | 'warn') =>
      entries.filter((entry) => level === undefined || entry.level === level).map((entry) => entry.msg),
  };
}
