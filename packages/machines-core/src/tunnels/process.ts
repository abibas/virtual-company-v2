import { TUNNEL_ERROR_MAX, type TunnelSpec, type TunnelState } from '@mwc/shared/runner-protocol';
import type { ProcessCommand } from '../driver.ts';

/**
 * What the tunnel supervisor (`../tunnels.ts`) is given, and its timing rules. Everything outside the process is
 * injected, so the package imports nothing of Node: a runner passes `child_process.spawn` and `process.kill(-pid)`, the
 * server the same from its platform, tests fakes.
 */

/** How long a tunnel's process stays alive before it counts as up. */
export const TUNNEL_UP_AFTER_MS = 10_000;
/** The first wait before a tunnel that ended starts again; it doubles at each failure in a row. */
export const TUNNEL_RETRY_INITIAL_MS = 5_000;
/** The longest wait between two starts. */
export const TUNNEL_RETRY_MAX_MS = 5 * 60_000;
/** A tunnel that stayed up this long starts again after the first wait when it ends. */
export const TUNNEL_STABLE_MS = 60_000;
/** How long a stopped tunnel has after SIGTERM before its group gets SIGKILL. */
export const TUNNEL_KILL_GRACE_MS = 5_000;

/** What the supervisor uses of a child process: its pid, its standard error, how it ends. */
export interface TunnelChild {
  readonly pid?: number | undefined;
  readonly stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  /** `close` comes once its output is read to the end. */
  once(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** The options a tunnel starts with: stdin and stdout ignored, stderr piped, its own process group. */
export interface TunnelSpawnOptions {
  readonly stdio: ['ignore', 'ignore', 'pipe'];
  readonly detached: true;
  readonly env?: Readonly<Record<string, string>>;
}

/** `child_process.spawn`, narrowed to what a tunnel needs. */
export type TunnelSpawn = (file: string, args: readonly string[], options: TunnelSpawnOptions) => TunnelChild;

/** Signals a detached child's whole process group (`process.kill(-pid, signal)`); quiet once it is gone. */
export type TunnelKill = (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;

/** Where the supervisor says what it does (the runner's JSON log, the server's logger). */
export interface TunnelLog {
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface TunnelDeps {
  /** The process of a tunnel (the driver's `tunnelCommand`); undefined when this holder cannot hold it. */
  readonly command: (tunnel: TunnelSpec) => ProcessCommand | undefined;
  readonly spawn: TunnelSpawn;
  readonly killGroup: TunnelKill;
  /** Monotonic milliseconds: awake time, as the timers count it. */
  readonly clock: { monotonic(): number };
  readonly timers: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly log: TunnelLog;
  /** Each change of a tunnel's state (a runner sends it to the server as `tunnel.state`; the server keeps it). */
  readonly report: (state: TunnelState) => void;
}

/** The wait before the start that follows `failures` failures in a row (0 for the first). */
export function retryDelay(failures: number): number {
  return Math.min(TUNNEL_RETRY_MAX_MS, TUNNEL_RETRY_INITIAL_MS * 2 ** failures);
}

/** The last line a process printed, trimmed and cut to the protocol's limit; undefined when it printed none. */
export function lastLine(output: string): string | undefined {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  return lines
    .filter((line) => line !== '')
    .at(-1)
    ?.slice(0, TUNNEL_ERROR_MAX);
}

/** What a tunnel forwards where: a change restarts it. */
export const tunnelKey = ({ target, remotePort, localPort }: TunnelSpec) =>
  JSON.stringify([target.provider, target.ref.instance, target.ref.zone, remotePort, localPort]);

/** Why a tunnel ended, as its `down` state says it. */
export const endText = (text: string) => (text.trim() || 'the tunnel ended').slice(0, TUNNEL_ERROR_MAX);
