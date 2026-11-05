import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { homePath, type LoginSandbox, type SandboxExit } from './port.ts';

/**
 * The process plumbing both helpers share: `childSandbox` turns a spawned login (behind its pseudo-terminal) into a
 * `LoginSandbox`, and `runCommand` runs a short command (a `docker` call) to its end. Both take node's `spawn` as a
 * parameter, so tests drive them with a fake child and start no process.
 */

/** `spawn` of `node:child_process`, as the helpers call it. */
export type Spawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** What a sandbox does besides its process: read a file of its home, and delete itself once the process is stopped. */
export interface SandboxParts {
  readFile(path: string): Promise<string | undefined>;
  dispose(): Promise<void>;
  /** Said when the program could not be found (spawn's ENOENT): which tool is missing. */
  readonly notFound: string;
}

/** Why a process did not run, in plain words: never the error's own text, which can carry paths or arguments. */
export function spawnFailure(error: unknown, notFound: string): string {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
    ? notFound
    : 'The sign-in helper could not start';
}

/** Emits chunks to the listeners, keeping them until the first listener arrives. */
function outputChannel() {
  const listeners: ((chunk: string) => void)[] = [];
  const backlog: string[] = [];
  return {
    add(listener: (chunk: string) => void) {
      listeners.push(listener);
      for (const chunk of backlog.splice(0)) listener(chunk);
    },
    emit(chunk: string) {
      if (chunk === '') return;
      if (listeners.length === 0) backlog.push(chunk);
      for (const listener of listeners) listener(chunk);
    },
  };
}

/** A spawned login as a sandbox: its output decoded as UTF-8 (stdout and stderr), its exit once, its input, kill. */
export function childSandbox(child: ChildProcess, parts: SandboxParts): LoginSandbox {
  const output = outputChannel();
  const exitListeners: ((exit: SandboxExit) => void)[] = [];
  let exited: SandboxExit | undefined;
  let killed: Promise<void> | undefined;
  const exit = (value: SandboxExit) => {
    if (exited !== undefined) return;
    exited = value;
    for (const listener of exitListeners.splice(0)) listener(value);
  };
  for (const stream of [child.stdout, child.stderr]) {
    const decoder = new StringDecoder('utf8');
    stream?.on('data', (data: Buffer) => output.emit(decoder.write(data)));
  }
  child.on('error', (error) => exit({ code: null, error: spawnFailure(error, parts.notFound) }));
  child.on('close', (code: number | null) => exit({ code }));
  // A write that races the CLI's exit is dropped (EPIPE), not thrown.
  child.stdin?.on('error', () => {});
  return {
    onOutput: (listener) => output.add(listener),
    onExit(listener) {
      if (exited === undefined) exitListeners.push(listener);
      else listener(exited);
    },
    write(input) {
      if (exited === undefined && child.stdin?.writable) child.stdin.write(input);
    },
    readFile: (path) => parts.readFile(homePath(path)),
    kill() {
      killed ??= (async () => {
        if (exited === undefined) child.kill('SIGKILL');
        await parts.dispose();
      })();
      return killed;
    },
  };
}

/** A finished command: its exit code (null when it did not run or was stopped) and its standard output. */
export interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  /** Set when it did not run: plain words. */
  readonly error?: string;
}

export interface CommandOptions {
  /** Written to its standard input, which is then closed. */
  readonly input?: string;
  /** Stopped (SIGKILL) after this long; the result's code is then null. */
  readonly timeoutMs: number;
  /** Said when the program is missing. */
  readonly notFound: string;
}

/** The most standard output kept: a login's files are a few kilobytes. */
const STDOUT_MAX = 4 * 1024 * 1024;

/** Runs a command to its end and gives its exit code and standard output (its standard error is dropped). */
export function runCommand(
  spawn: Spawn,
  command: string,
  args: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    let stdout = '';
    let done = false;
    const finish = (result: CommandResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < STDOUT_MAX) stdout += chunk;
    });
    child.stderr?.resume();
    child.on('error', (error) =>
      finish({ code: null, stdout: '', error: spawnFailure(error, options.notFound) }),
    );
    child.on('close', (code: number | null) => finish({ code, stdout }));
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input);
  });
}
