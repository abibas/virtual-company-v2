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
import { type RunnerConfig, runnerWsUrl } from '../../config.ts';
import { HoldManager, type HoldReport } from '../../hold/manager.ts';
import { Commands } from '../../link/commands.ts';
import { Heartbeats } from '../../link/heartbeat.ts';
import { Link, type LinkEnd } from '../../link/link.ts';
import { NO_POWER, type PowerExecutor } from '../../power/executor.ts';
import { type Clock, SYSTEM_CLOCK, SYSTEM_TIMERS, type Timers } from '../../system/time.ts';
import { TerminalSessions } from '../../terminal/sessions.ts';
import { Updates } from '../../update/updates.ts';
import type { HealthStatus } from '../health.ts';
import type { Runner, RunnerOptions } from '../runner.ts';

/**
 * The daemon behind `createRunner` (`../runner.ts`, its contract): it makes the hold manager, the heartbeats, the
 * commands, the terminals, the self-update, a power controller's tunnels and the link, and wires each to the others.
 */

const holdState = (state: HoldReport): HoldState => ({ type: 'hold.state', ...state });
const resync = (): RunnerResync => ({ type: 'runner.resync', runs: [] });

export class RunnerDaemon implements Runner {
  readonly ended: Promise<LinkEnd>;
  readonly restart: Promise<void>;
  readonly #options: RunnerOptions;
  readonly #power: PowerExecutor;
  readonly #hold: HoldManager;
  readonly #heartbeats: Heartbeats;
  readonly #commands: Commands;
  readonly #link: Link;
  readonly #tunnels: Tunnels | undefined;
  readonly #terminals: TerminalSessions;
  readonly #updates: Updates;
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
      update: (frame) => this.#updates.handle(frame),
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
    this.#updates = new Updates({
      update: options.update,
      serverUrl: () => this.#config.serverUrl,
      liveRuns,
      closeTerminals: (notice) => this.#terminals.closeAll('runner_updating', notice),
      timers,
      log,
    });
    this.restart = this.#updates.restart;
    this.#tunnels = this.#controllerTunnels(clock, timers);
    this.#link = this.#makeLink(clock, timers);
    this.ended = this.#link.ended;
  }

  /** A power controller's tunnels (`tunnel.set`), reported through the link; none without power or processes. */
  #controllerTunnels(clock: Clock, timers: Timers): Tunnels | undefined {
    const { processes, log } = this.#options;
    if (this.#power.providers.length === 0 || processes === undefined) return undefined;
    return new Tunnels({
      command: (tunnel) => this.#power.tunnelCommand?.(tunnel),
      clearPortCommand: this.#power.clearPortCommand?.bind(this.#power),
      ...processes,
      clock,
      timers,
      log,
      report: (state) => this.#link.send(state),
    });
  }

  /** The link to the server, wired to the hello, the heartbeats, the commands and the terminals. */
  #makeLink(clock: Clock, timers: Timers): Link {
    const options = this.#options;
    return new Link({
      url: runnerWsUrl(options.config.serverUrl),
      key: () => this.#config.runnerKey,
      WebSocket: options.WebSocket ?? WebSocket,
      clock,
      timers,
      random: options.random ?? Math.random,
      log: options.log,
      hello: () => this.#hello(),
      afterHello: (hello) => this.#afterHello(hello),
      beat: () => this.#beat(),
      handle: (frame) => this.#commands.handle(frame),
      refuse: (text, why) => this.#commands.refuse(text, why),
      dropped: () => void this.#terminals.closeAll('link_lost'),
    });
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
      selfUpdate: this.#updates.available,
    };
    const { version, claudeVersion, build } = this.#options;
    return {
      type: 'runner.hello',
      protocol: RUNNER_PROTOCOL_VERSION,
      version,
      caps,
      ...(claudeVersion === undefined ? {} : { claudeVersion }),
      ...(build === undefined ? {} : { build }),
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
