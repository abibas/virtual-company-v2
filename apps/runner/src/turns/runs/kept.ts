import { connect, type Socket } from 'node:net';
import type { ChildLike, Spawn } from '../../system/process.ts';
import type { Timers } from '../../system/time.ts';
import { LineReader } from '../lines.ts';

/**
 * The runner's hold on a turn's keeper (S5.4, `keeper.ts`): the keeper it started (its stdin is the line, its exit the
 * end) or one it found again after a restart (its socket is the line, the socket's close the end). Either way the line
 * takes the keeper's commands (`{"w":…}`, `{"end":true}`); letting go (`release`) closes the line without `end`, so
 * the harness runs on for the next runner.
 */

/** How the keeper is started: the runner's own Node and bundle, `keep` (`<node> <runner.mjs> keep`). */
export interface KeeperCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** How long a re-attaching runner waits for a keeper's greeting. */
export const KEEPER_CONNECT_MS = 2_000;

/** A turn's keeper as the runner holds it. */
export interface Kept {
  /** Its pid, which is its process group's: what the stop ladder signals while it is there (undefined: none). */
  readonly pid: number | undefined;
  /** True until it ended (or the line to it closed). */
  readonly alive: boolean;
  /** Writes text to the harness's stdin; false once the line is closed. */
  write(text: string): boolean;
  /** Closes the harness's stdin. */
  end(): void;
  /** Calls `listener` once, when it ended (or never started: `error`). */
  gone(listener: (error?: string) => void): void;
  /** Lets go without ending anything: the harness runs on. */
  release(): void;
}

const command = (value: object) => `${JSON.stringify(value)}\n`;

/** A line of commands over a writable stream, ended by `end` or let go by `release`. */
function lineOf(
  stream: NodeJS.WritableStream | null | undefined,
  pid: number | undefined,
  letGo: () => void,
): Kept & { ended(error?: string): void } {
  let alive = true;
  const listeners: ((error?: string) => void)[] = [];
  stream?.on('error', () => {
    // The keeper went away: its end comes as its exit or the socket's close.
  });
  return {
    pid,
    get alive() {
      return alive;
    },
    write: (text) => alive && stream?.write(command({ w: text })) !== undefined,
    end: () => {
      if (alive) stream?.write(command({ end: true }));
    },
    gone: (listener) => {
      if (alive) listeners.push(listener);
      else listener();
    },
    release: () => {
      alive = false;
      listeners.length = 0;
      letGo();
    },
    ended: (error) => {
      if (!alive) return;
      alive = false;
      for (const listener of listeners.splice(0)) listener(error);
    },
  };
}

/** The pid a keeper's greeting names; undefined for anything else. */
export function pidOf(greeting: string): number | undefined {
  try {
    const pid = (JSON.parse(greeting) as { pid?: unknown } | null)?.pid;
    return Number.isInteger(pid) && (pid as number) > 0 ? (pid as number) : undefined;
  } catch {
    return undefined;
  }
}

/** Starts a turn's keeper (its own session and process group) in the agent's folder with the harness's environment. */
export function spawnKeeper(
  spawn: Spawn,
  keeper: KeeperCommand,
  run: {
    readonly dir: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  },
): Kept {
  const child: ChildLike = spawn(keeper.command, [...keeper.args, run.dir, '--', run.command, ...run.args], {
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: true,
    cwd: run.cwd,
    env: run.env,
  });
  const pid = child.pid !== undefined && child.pid > 0 ? child.pid : undefined;
  const line = lineOf(child.stdin, pid, () => {
    child.stdin?.end();
    (child as { unref?: () => void }).unref?.();
  });
  child.once('error', (error) => line.ended(error.message));
  child.once('exit', () => line.ended());
  return line;
}

/**
 * Connects to a keeper's socket and waits for its greeting (its pid); undefined when no keeper answers there in
 * `KEEPER_CONNECT_MS` (it ended, or never had a socket). The socket is the proof the process is the turn's own, so a
 * pid the system gave someone else meanwhile is never signalled.
 */
export function connectKeeper(path: string, timers: Timers): Promise<Kept | undefined> {
  return new Promise((resolve) => {
    let socket: Socket;
    try {
      socket = connect(path);
    } catch {
      resolve(undefined);
      return;
    }
    const reader = new LineReader();
    let line: (Kept & { ended(): void }) | undefined;
    const timer = timers.setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, KEEPER_CONNECT_MS);
    socket.on('error', () => {
      timers.clearTimeout(timer);
      resolve(undefined);
    });
    socket.on('close', () => line?.ended());
    socket.on('data', (chunk) => {
      if (line !== undefined) return;
      const [greeting] = reader.push(chunk);
      if (greeting === undefined) return;
      const pid = pidOf(greeting);
      timers.clearTimeout(timer);
      if (pid === undefined) {
        socket.destroy();
        resolve(undefined);
        return;
      }
      line = lineOf(socket, pid, () => socket.destroy());
      resolve(line);
    });
  });
}
