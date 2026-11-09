import type { WebSocketCtor } from '../link/socket.ts';
import type { PowerExecutor } from '../power/executor.ts';
import type { MemoryDeps } from '../stats/memory.ts';
import type { DiskStats, SamplerOs } from '../stats/sampler.ts';
import type { PtyLoad } from '../terminal/loader.ts';
import type { SelfUpdate } from '../update/self-update.ts';
import type { KillGroup, Spawn } from './process.ts';
import type { Clock, Timers } from './time.ts';

/**
 * The process the daemon runs on (`daemon/start.ts`'s `main`): its environment, Node's `os` and files as the runner
 * reads them, process starts, the WebSocket, time, the log's output, signals and its exit, and what `cli.ts` learned at
 * start (Claude Code's version, the build, the self-update). `node.ts` is the real one; tests pass fakes.
 */
export interface MainDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** The runner's process id (`caffeinate -w`). */
  readonly pid: number;
  readonly os: SamplerOs & MemoryDeps['os'] & { homedir(): string };
  readonly fs: {
    exists(path: string): boolean;
    readFile(path: string): Promise<string>;
    statfs(path: string): Promise<DiskStats>;
    /** Makes a folder and its parents, new ones 0700. */
    mkdir(path: string): void;
  };
  readonly spawn: Spawn;
  /** Signals a detached child's process group (a power controller's tunnels). */
  readonly killGroup: KillGroup;
  readonly WebSocket: WebSocketCtor;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly random: () => number;
  /** One log line to standard output. */
  write(line: string): void;
  onSignal(signal: 'SIGTERM' | 'SIGINT', handler: () => void): void;
  exit(code: number): void;
  /** Keeps the process alive with nothing else to do (a replaced link); returns the release. */
  keepAlive(): () => void;
  readonly version: string;
  /** Claude Code's version (`cli.ts` asks `claude --version` once), sent in the hello; left out when unknown. */
  readonly claudeVersion?: string | null;
  /** The build it runs (`cli.ts` hashes the bundle once), sent in the hello; left out when unknown. */
  readonly build?: string | null;
  /** How it updates itself, for an installed copy under launchd or systemd (`cli.ts`); none otherwise. */
  readonly update?: SelfUpdate;
  /** The power controller (S4.4b); none by default. */
  readonly power?: PowerExecutor;
  /** Loads the terminal's PTY (`terminal/loader.ts`), once, when the daemon starts. */
  loadPty(): PtyLoad;
}
