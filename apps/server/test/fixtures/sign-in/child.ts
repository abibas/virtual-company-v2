/**
 * A fake child process for the sign-in helpers' tests: `fakeSpawn()` records every spawn and hands out a `FakeChild`
 * whose streams and exit the test drives, so the Docker and local helpers are tested without starting a process.
 */
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Spawn } from '../../../src/platform/login-helper/process.ts';

export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  /** What was written to its standard input. */
  readonly input: string[] = [];
  /** The signals it was sent. */
  readonly signals: string[] = [];
  stdinEnded = false;

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => this.input.push(chunk.toString('utf8')));
    this.stdin.on('finish', () => {
      this.stdinEnded = true;
    });
  }

  kill(signal: string): boolean {
    this.signals.push(signal);
    return true;
  }

  /** Prints `stdout`, then exits with `code` once the output is read, on a later tick. */
  answer(stdout: string, code: number | null): void {
    setImmediate(() => {
      this.stdout.once('end', () => this.emit('close', code));
      this.stdout.end(stdout);
    });
  }

  /** Fails to start, as spawn does for a missing program. */
  failToStart(code = 'ENOENT'): void {
    setImmediate(() => this.emit('error', Object.assign(new Error(`spawn failed: ${code}`), { code })));
  }
}

export interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
  readonly child: FakeChild;
}

/** A spawn that records each call; `script` makes each child answer (or not). */
export function fakeSpawn(script: (call: SpawnCall) => void = () => {}) {
  const calls: SpawnCall[] = [];
  const spawn: Spawn = (command, args, options) => {
    const call = { command, args: [...args], options, child: new FakeChild() };
    calls.push(call);
    script(call);
    return call.child as unknown as ChildProcess;
  };
  return { spawn, calls };
}
