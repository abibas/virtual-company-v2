import type { RunnerConfig } from '../config.ts';
import type { FolderHost } from '../folders/browse.ts';
import type { HoldDriver } from '../hold/driver.ts';
import type { HeartbeatDeps } from '../link/heartbeat.ts';
import type { LinkEnd } from '../link/link.ts';
import type { WebSocketCtor } from '../link/socket.ts';
import type { PowerExecutor } from '../power/executor.ts';
import type { Log } from '../system/log.ts';
import type { KillGroup, Spawn } from '../system/process.ts';
import type { Clock, Timers } from '../system/time.ts';
import type { TerminalHost } from '../terminal/sessions.ts';
import type { HarnessHost } from '../turns/turns.ts';
import type { SelfUpdate } from '../update/self-update.ts';
import type { HealthStatus } from './health.ts';
import { RunnerDaemon } from './runner/daemon.ts';

/**
 * The runner (`@mwc/runner/runner`): the link to the server, the heartbeats with the machine's samples, the hold and
 * the commands, a power controller's tunnels, the chat turns, the machine's terminals and its self-update, put together.
 * `start()` connects and keeps reconnecting; `stop()` ends the turns and the terminals, closes the socket, releases the
 * hold and stops the tunnels; `setLiveRuns(n)` is how S5's runs tell it how many are live (the runner holds the machine
 * while any run or turn is live, or any terminal is open); `ended` resolves when the link stops for good, `restart` once
 * an update is in place. Everything outside the process is injected. This entry is the contract; the daemon that keeps
 * it is `runner/daemon.ts`.
 */

export interface RunnerOptions {
  readonly config: RunnerConfig;
  /** This runner's version (`runner.hello.version`). */
  readonly version: string;
  /** What `claude --version` printed when the runner started, null without Claude Code; left out of the hello unset. */
  readonly claudeVersion?: string | null;
  /** The build it runs (its bundle's SHA-256, null from the sources); left out of the hello unset. */
  readonly build?: string | null;
  /** How it updates itself (`runner.update`); without it the runner answers `unsupported` (`caps.selfUpdate` false). */
  readonly update?: SelfUpdate;
  readonly log: Log;
  /** How it holds the machine (`hold/`): `caps.hold` is its kind. */
  readonly hold: HoldDriver;
  /** The machine's sampler (`stats/sampler.ts`). */
  readonly sampler: HeartbeatDeps['sampler'];
  /** What it does with `power.command`; `NO_POWER` (every command fails with `no_power_driver`) by default. */
  readonly power?: PowerExecutor;
  /** How turns and a power controller's tunnels start and stop (`tunnel.set`); without it, no turn and no tunnel. */
  readonly processes?: { readonly spawn: Spawn; readonly killGroup: KillGroup };
  /** The PTY and what a shell needs (`terminal/`); without it the runner opens no terminal (`caps.terminal` false). */
  readonly terminal?: TerminalHost;
  /**
   * The harnesses' drivers and what a turn needs (`turns/`): with `processes`, the runner runs chat turns and opens
   * chats' terminals (`caps.harnesses` their versions); without them it has none and every `turn.start` is `unsupported`.
   */
  readonly harness?: HarnessHost;
  /**
   * The folder browser's file system, home and root (`/work` in a container): with it the runner answers `fs.list` and
   * `fs.mkdir` (`caps.folders`); without it every one is `unsupported`.
   */
  readonly folders?: FolderHost;
  /** Saves the configuration after `key.rotate`; without it the new key lives in memory only. */
  readonly saveConfig?: (config: RunnerConfig) => void | Promise<void>;
  readonly clock?: Clock;
  readonly timers?: Timers;
  /** In [0, 1), for the reconnect jitter; `Math.random` by default. */
  readonly random?: () => number;
  /** `ws`'s WebSocket by default. */
  readonly WebSocket?: WebSocketCtor;
}

export interface Runner {
  /** Connects, and reconnects after every close until the link ends. */
  start(): void;
  /** Ends the turns and the terminals, closes the socket and releases the hold. */
  stop(): Promise<void>;
  /** How many runs are live; the hold follows the first start and the last end. Resolves once applied. */
  setLiveRuns(count: number): Promise<void>;
  /** What the health endpoint answers. */
  status(): HealthStatus;
  /** True after `runner.drain`: no new runs until the runner restarts. */
  readonly draining: boolean;
  /** How the link ended for good: stopped, unauthorized, too old or replaced. */
  readonly ended: Promise<LinkEnd>;
  /** Resolves once an update is in place and answered: the daemon stops and exits for its service manager to restart. */
  readonly restart: Promise<void>;
}

/** Makes a runner; nothing happens until `start()`. */
export function createRunner(options: RunnerOptions): Runner {
  return new RunnerDaemon(options);
}
