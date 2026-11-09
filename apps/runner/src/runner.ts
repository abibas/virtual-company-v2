import { Tunnels } from '@mwc/machines-core/tunnels';
import {
  type HoldState,
  RUNNER_PROTOCOL_VERSION,
  type RunnerFrame,
  type RunnerHello,
  type RunnerResync,
  type ServerHello,
  type TunnelSpec,
} from '@mwc/shared/runner-protocol';
import { WebSocket } from 'ws';
import { type RunnerConfig, runnerWsUrl } from './config.ts';
import type { HealthStatus } from './health.ts';
import type { HoldDriver } from './hold/driver.ts';
import { HoldManager, type HoldReport } from './hold/manager.ts';
import { Commands } from './link/commands.ts';
import { type HeartbeatDeps, Heartbeats } from './link/heartbeat.ts';
import { Link, type LinkEnd } from './link/link.ts';
import type { WebSocketCtor } from './link/socket.ts';
import type { Log } from './log.ts';
import { NO_POWER, type PowerExecutor } from './power.ts';
import type { KillGroup, Spawn } from './system/process.ts';
import { type Clock, SYSTEM_CLOCK, SYSTEM_TIMERS, type Timers } from './system/time.ts';
import { type TerminalHost, TerminalSessions } from './terminal/sessions.ts';

/**
 * The runner (`@mwc/runner/runner`): the link to the server, the heartbeats with the machine's samples, the hold and
 * the commands, a power controller's tunnels and the machine's terminals, put together. `start()` connects and keeps
 * reconnecting; `stop()` ends the terminals, closes the socket, releases the hold and stops the tunnels; `setLiveRuns(n)`
 * is how S5's runs tell it how many are live (the runner holds the machine while any is, or any terminal is open);
 * `ended` resolves when the link stops for good. Everything outside the process is injected.
 */

export interface RunnerOptions {
  readonly config: RunnerConfig;
  /** This runner's version (`runner.hello.version`). */
  readonly version: string;
  /** What `claude --version` printed when the runner started, null without Claude Code; left out of the hello unset. */
  readonly claudeVersion?: string | null;
  readonly log: Log;
  /** How it holds the machine (`hold/`): `caps.hold` is its kind. */
  readonly hold: HoldDriver;
  /** The machine's sampler (`stats/sampler.ts`). */
  readonly sampler: HeartbeatDeps['sampler'];
  /** What it does with `power.command`; `NO_POWER` (every command fails with `no_power_driver`) by default. */
  readonly power?: PowerExecutor;
  /** How a power controller starts and stops its tunnels (`tunnel.set`); without it, or without power, none. */
  readonly processes?: { readonly spawn: Spawn; readonly killGroup: KillGroup };
  /** The PTY and what a shell needs (`terminal/`); without it the runner opens no terminal (`caps.terminal` false). */
  readonly terminal?: TerminalHost;
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
  /** Ends the terminals, closes the socket and releases the hold. */
  stop(): Promise<void>;
  /** How many runs are live; the hold follows the first start and the last end. Resolves once applied. */
  setLiveRuns(count: number): Promise<void>;
  /** What the health endpoint answers. */
  status(): HealthStatus;
  /** True after `runner.drain`: no new runs until the runner restarts. */
  readonly draining: boolean;
  /** How the link ended for good: stopped, unauthorized, too old or replaced. */
  readonly ended: Promise<LinkEnd>;
}

/** Makes a runner; nothing happens until `start()`. */
export function createRunner(options: RunnerOptions): Runner {
  return new RunnerDaemon(options);
}

const holdState = (state: HoldReport): HoldState => ({ type: 'hold.state', ...state });
const resync = (): RunnerResync => ({ type: 'runner.resync', runs: [] });

class RunnerDaemon implements Runner {
  readonly ended: Promise<LinkEnd>;
  readonly #options: RunnerOptions;
  readonly #power: PowerExecutor;
  readonly #hold: HoldManager;
  readonly #heartbeats: Heartbeats;
  readonly #commands: Commands;
  readonly #link: Link;
  readonly #tunnels: Tunnels | undefined;
  readonly #terminals: TerminalSessions;
  #config: RunnerConfig;
  #draining = false;

  constructor(options: RunnerOptions) {
    const { log } = options;
    const clock = options.clock ?? SYSTEM_CLOCK;
    const timers = options.timers ?? SYSTEM_TIMERS;
    this.#options = options;
    this.#config = options.config;
    this.#power = options.power ?? NO_POWER;
    // The manager reports through the link, made below; nothing changes the hold before the constructor returns.
    const report = (state: HoldReport) => this.#reportHold(state);
    this.#hold = new HoldManager({ driver: options.hold, clock, timers, log, report });
    const liveRuns = () => this.#hold.liveRuns;
    this.#heartbeats = new Heartbeats({ clock, sampler: options.sampler, liveRuns, log });
    this.#commands = new Commands({
      setServerHold: (until) => this.#hold.setServerHold(until),
      power: this.#power,
      saveKey: (runnerKey) => this.#saveKey(runnerKey),
      drain: () => this.#drain(),
      setTunnels: (tunnels) => this.#setTunnels(tunnels),
      terminal: (frame) => this.#terminals.handle(frame),
      log,
    });
    this.#terminals = new TerminalSessions({
      host: options.terminal,
      timers,
      log,
      send: (frame) => this.#link.send(frame),
      buffered: () => this.#link.bufferedAmount,
      count: (open) => void this.#hold.setTerminals(open),
    });
    const { processes } = options;
    const controller = this.#power.providers.length > 0 && processes !== undefined;
    this.#tunnels = controller
      ? new Tunnels({
          command: (tunnel) => this.#power.tunnelCommand?.(tunnel),
          ...processes,
          clock,
          timers,
          log,
          report: (state) => this.#link.send(state),
        })
      : undefined;
    this.#link = new Link({
      url: runnerWsUrl(options.config.serverUrl),
      key: () => this.#config.runnerKey,
      WebSocket: options.WebSocket ?? WebSocket,
      clock,
      timers,
      random: options.random ?? Math.random,
      log,
      hello: () => this.#hello(),
      afterHello: (hello) => this.#afterHello(hello),
      beat: () => this.#beat(),
      handle: (frame) => this.#commands.handle(frame),
      refuse: (text, why) => this.#commands.refuse(text, why),
      dropped: () => void this.#terminals.closeAll('link_lost'),
    });
    this.ended = this.#link.ended;
  }

  get draining(): boolean {
    return this.#draining;
  }

  start(): void {
    this.#link.start();
  }

  async stop(): Promise<void> {
    await this.#terminals.stop();
    await this.#link.stop();
    await Promise.all([this.#hold.close(), this.#tunnels?.close()]);
  }

  setLiveRuns(count: number): Promise<void> {
    return this.#hold.setLiveRuns(count);
  }

  status(): HealthStatus {
    const { connected } = this.#link;
    return {
      connected,
      liveRuns: this.#hold.liveRuns,
      backlog: 0,
      version: this.#options.version,
      holdUntil: this.#hold.state.until,
    };
  }

  #hello(): RunnerHello {
    const caps = {
      harnesses: ['claude_code' as const],
      slots: this.#config.slots,
      hold: this.#options.hold.kind,
      power: [...this.#power.providers],
      terminal: this.#terminals.available,
    };
    const { version, claudeVersion } = this.#options;
    return {
      type: 'runner.hello',
      protocol: RUNNER_PROTOCOL_VERSION,
      version,
      caps,
      ...(claudeVersion === undefined ? {} : { claudeVersion }),
    };
  }

  #afterHello(hello: ServerHello): RunnerFrame[] {
    if (hello.machineId !== this.#config.machineId) {
      this.#options.log.warn('the server names another machine than runner.json', {
        configured: this.#config.machineId,
        server: hello.machineId,
      });
    }
    this.#heartbeats.connected();
    return [resync(), holdState(this.#hold.state), ...(this.#tunnels?.states() ?? [])];
  }

  async #beat(): Promise<RunnerFrame[]> {
    const next = await this.#heartbeats.next();
    if (!next.slept) return [next.frame];
    this.#options.log.info('the machine slept; resyncing', { gapMs: next.gapMs });
    // A server hold may have ended during the sleep, and a held devbox is due its refresh.
    await this.#hold.refresh();
    return [resync(), holdState(this.#hold.state), next.frame];
  }

  #reportHold(state: HoldReport): void {
    const until = state.until === null ? null : new Date(state.until).toISOString();
    this.#options.log.info('hold changed', { until, source: state.source });
    this.#link.send(holdState(state));
  }

  async #saveKey(runnerKey: string): Promise<void> {
    const next = { ...this.#config, runnerKey };
    await this.#options.saveConfig?.(next);
    this.#config = next;
  }

  #setTunnels(tunnels: readonly TunnelSpec[]): void {
    if (this.#tunnels === undefined) {
      this.#options.log.info('ignored tunnel.set: this runner powers no machine', {
        tunnels: tunnels.length,
      });
      return;
    }
    this.#tunnels.set(tunnels);
  }

  #drain(): void {
    this.#draining = true;
    this.#options.log.info('draining: no new runs until the runner restarts');
  }
}
