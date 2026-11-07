import type { Timers } from './time.ts';

/**
 * Process starts, injected: Node's `child_process.spawn` in the daemon, a fake in tests (`test/fixtures/spawn.ts`).
 * The Mac's security agent bills every process start, so the runner starts few: one `sysctl` a minute at most, one
 * `caffeinate` per hold, one `devbox-keepalive` per refresh on the box, one tunnel per powered box (restarted slowly).
 */

/** What the runner uses of a child process. */
export interface ChildLike {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  /** Piped only for a tunnel, whose last line says why it ended. */
  readonly stderr?: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  /** `exit` when the process ends; `close` once its output is read to the end too. */
  once(
    event: 'exit' | 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * The options the runner passes: stdin ignored, stdout piped when it reads it, stderr piped only for a tunnel, which
 * is also `detached` (its own process group, so its children are stopped with it) and may bring its own environment.
 */
export interface SpawnOptions {
  readonly stdio: ['ignore', 'pipe' | 'ignore', 'ignore' | 'pipe'];
  readonly detached?: boolean;
  readonly env?: Readonly<Record<string, string>>;
}

/** `child_process.spawn`, narrowed to what the runner uses. */
export type Spawn = (file: string, args: readonly string[], options: SpawnOptions) => ChildLike;

/** Sends a signal to a detached child's whole process group (`process.kill(-pid, signal)`); quiet once it is gone. */
export type KillGroup = (pid: number, signal: NodeJS.Signals) => void;

/** How a command ended: its exit code (null when it did not exit by itself), its output, and why it failed. */
export interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly error?: string;
}

export interface RunCommandOptions {
  readonly spawn: Spawn;
  readonly timers: Timers;
  /** Killed (SIGKILL) after this long; 10 s by default. */
  readonly timeoutMs?: number;
}

export const COMMAND_TIMEOUT_MS = 10_000;

/** Runs a command to its end and collects its standard output; never throws. */
export function runCommand(
  file: string,
  args: readonly string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let timer: unknown;
    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      options.timers.clearTimeout(timer);
      resolve(result);
    };
    let child: ChildLike;
    try {
      child = options.spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      settle({ code: null, stdout, error: (error as Error).message });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.once('error', (error) => settle({ code: null, stdout, error: error.message }));
    child.once('close', (code, signal) =>
      settle(code === null ? { code, stdout, error: `killed by ${signal ?? 'a signal'}` } : { code, stdout }),
    );
    const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
    timer = options.timers.setTimeout(() => {
      child.kill('SIGKILL');
      settle({ code: null, stdout, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
  });
}
