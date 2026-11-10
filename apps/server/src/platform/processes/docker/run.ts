import { StringDecoder } from 'node:string_decoder';

/**
 * One `docker` command the server runs to its end for the machines module (docs/machines.md, "Updating a runner"): its
 * standard output kept (a `docker inspect` answer), both streams split into lines for whoever follows its progress (a
 * rebuild's build steps), the last ones kept for its error, and a time limit past which its process group gets SIGTERM,
 * then SIGKILL 5 s later. It runs in its own process group (compose starts buildx and the build's helpers).
 */

/** What the runner uses of a child process: its pid, its two output streams, how it ends. */
export interface DockerChild {
  readonly pid?: number | undefined;
  readonly stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  readonly stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  /** `close` comes once its output is read to the end. */
  once(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** The options a command starts with: no input, both outputs piped, its own process group, its environment. */
export interface DockerSpawnOptions {
  readonly stdio: ['ignore', 'pipe', 'pipe'];
  readonly detached: true;
  readonly env: Readonly<Record<string, string>>;
}

/** `child_process.spawn`, narrowed to what a command needs. */
export type DockerSpawn = (file: string, args: readonly string[], options: DockerSpawnOptions) => DockerChild;

export interface RunDeps {
  readonly spawn: DockerSpawn;
  /** Signals the whole process group (`process.kill(-pid, signal)`), quiet once it is gone. */
  readonly killGroup: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  readonly timers: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** How a command is run: its environment, its time limit, and who hears each output line. */
export interface RunOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly onLine?: (line: string) => void;
}

/** How a command ended: its standard output, its last lines, and why it did not end well. */
export interface DockerResult {
  /** True when it exited 0. */
  readonly ok: boolean;
  readonly stdout: string;
  /** The last `KEPT_LINES` lines of both streams. */
  readonly lines: readonly string[];
  /** Why not: its last line, its exit code or signal, the time limit, or why it did not start. Unset when ok. */
  readonly error?: string;
}

/** How long a command past its limit has after SIGTERM before its group gets SIGKILL. */
export const KILL_GRACE_MS = 5_000;

/** How many of the last output lines are kept. */
export const KEPT_LINES = 40;

/** The longest line kept or passed on. */
const LINE_MAX = 500;

/** The most standard output kept: a `docker inspect` answer is a few kilobytes. */
const STDOUT_MAX = 4 * 1024 * 1024;

/** The time limit in words: "15 minutes", "30 s". */
const limitText = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${ms / 1000} s`);

/** Splits a stream into lines (on `\n` or `\r`, which a build's progress uses), trimmed, the empty ones dropped. */
function lineSplitter(onLine: (line: string) => void) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  const emit = (text: string) => {
    const line = text.trim();
    if (line !== '') onLine(line.slice(0, LINE_MAX));
  };
  return {
    write(chunk: unknown) {
      const parts = `${rest}${decoder.write(chunk as Buffer)}`.split(/\r?\n|\r/);
      rest = parts.pop() ?? '';
      for (const part of parts) emit(part);
    },
    end() {
      emit(`${rest}${decoder.end()}`);
      rest = '';
    },
  };
}

/** Runs `file args` to its end, or stops it after `timeoutMs`; never rejects. */
export function runDocker(
  deps: RunDeps,
  file: string,
  args: readonly string[],
  options: RunOptions,
): Promise<DockerResult> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    let stdout = '';
    const keep = (line: string) => {
      lines.push(line);
      if (lines.length > KEPT_LINES) lines.shift();
      options.onLine?.(line);
    };
    let child: DockerChild;
    try {
      child = deps.spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: options.env });
    } catch (error) {
      resolve({ ok: false, stdout, lines, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const out = lineSplitter(keep);
    const err = lineSplitter(keep);
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < STDOUT_MAX) stdout += String(chunk);
      out.write(chunk);
    });
    child.stderr?.on('data', (chunk) => err.write(chunk));
    let timedOut = false;
    let killTimer: unknown;
    let done = false;
    const timer = deps.timers.setTimeout(() => {
      timedOut = true;
      const { pid } = child;
      if (pid === undefined) return;
      deps.killGroup(pid, 'SIGTERM');
      killTimer = deps.timers.setTimeout(() => deps.killGroup(pid, 'SIGKILL'), KILL_GRACE_MS);
    }, options.timeoutMs);
    const finish = (result: DockerResult) => {
      if (done) return;
      done = true;
      deps.timers.clearTimeout(timer);
      deps.timers.clearTimeout(killTimer);
      resolve(result);
    };
    child.once('error', (error) => finish({ ok: false, stdout, lines, error: error.message }));
    child.once('close', (code, signal) => {
      out.end();
      err.end();
      if (timedOut) {
        finish({ ok: false, stdout, lines, error: `it did not end within ${limitText(options.timeoutMs)}` });
      } else if (code === 0) {
        finish({ ok: true, stdout, lines });
      } else {
        const why = lines.at(-1) ?? (code === null ? `ended by ${signal}` : `exit code ${code}`);
        finish({ ok: false, stdout, lines, error: why });
      }
    });
  });
}
