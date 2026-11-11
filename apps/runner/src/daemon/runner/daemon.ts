import { Tunnels } from '@mwc/machines-core/tunnels';
import type {
  HoldState,
  RunnerCaps,
  RunnerFrame,
  RunnerHello,
  RunnerResync,
  ServerHello,
  TunnelSpec,
} from '@mwc/shared/runner-protocol';
import { WebSocket } from 'ws';
import { type RunnerConfig, runnerWsUrl } from '../../config.ts';
import { browse } from '../../folders/browse.ts';
import { HoldManager, type HoldReport } from '../../hold/manager.ts';
import { Commands } from '../../link/commands.ts';
import { Heartbeats } from '../../link/heartbeat.ts';
import { Link, type LinkEnd } from '../../link/link.ts';
import { NO_POWER, type PowerExecutor } from '../../power/executor.ts';
import { type Clock, SYSTEM_CLOCK, SYSTEM_TIMERS, type Timers } from '../../system/time.ts';
import { TerminalSessions } from '../../terminal/sessions.ts';
import { Tools } from '../../tools/tools.ts';
import { Turns } from '../../turns/turns.ts';
import { Updates } from '../../update/updates.ts';
import type { HealthStatus } from '../health.ts';
import type { Runner, RunnerOptions } from '../runner.ts';
import { helloOf, NO_HARNESSES } from './hello.ts';

/**
 * The daemon behind `createRunner` (`../runner.ts`, its contract): it makes the hold manager, the heartbeats, the
 * commands, the chat turns, the terminals, the self-update, the machine's tools, a power controller's tunnels and the
 * link, and wires each to the others (and the commands to the folder browser). Live turns and the runs `setLiveRuns`
 * reports count together as live work for the hold; a change of the tools is sent as `runner.caps`. Turns outlive the
 * link and the runner (S5.4): it takes back the ones on its disk before its first hello, names them in each hello, and
 * a dropped link or a stop leaves them running; a self-update waits for runs and terminals, not for turns.
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
  readonly #turns: Turns;
  readonly #updates: Updates;
  readonly #tools: Tools;
  #config: RunnerConfig;
  #draining = false;
  #stopped = false;
  #runs = 0;

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
      turn: (frame) => this.#turns.handle(frame),
      update: (frame) => this.#updates.handle(frame),
      folders: (frame) => browse(this.#options.folders, frame),
      tools: (frame) => this.#tools.handle(frame),
      log,
    });
    this.#tools = this.#makeTools(timers);
    this.#turns = new Turns({
      host: options.harness,
      processes: options.processes,
      slots: () => this.#config.slots,
      clock,
      timers,
      log,
      send: (frame) => this.#link.send(frame),
      count: () => void this.#applyLive(),
    });
    this.#terminals = new TerminalSessions({
      host: options.terminal,
      harness: options.harness,
      timers,
      log,
      send: (frame) => this.#link.send(frame),
      buffered: () => this.#link.bufferedAmount,
      count: (open) => void this.#hold.setTerminals(open),
    });
    this.#updates = new Updates({
      update: options.update,
      serverUrl: () => this.#config.serverUrl,
      // Chat turns outlive the restart (S5.4): only runs and terminals would end with it.
      liveRuns: () => this.#runs,
      openTerminals: () => this.#terminals.open,
      installing: () => this.#tools.installing,
      closeTerminals: (notice) => this.#terminals.closeAll('runner_updating', notice),
      timers,
      log,
    });
    this.restart = this.#updates.restart;
    this.#tunnels = this.#controllerTunnels(clock, timers);
    this.#link = this.#makeLink(clock, timers);
    this.ended = this.#link.ended;
  }

  /** The machine's tools: their output and a change of them (`runner.caps`) go through the link. */
  #makeTools(timers: Timers): Tools {
    const { tools, processes, harness, log } = this.#options;
    return new Tools({
      ...{ host: tools?.host, found: tools?.found, processes, harness, timers, log },
      send: (frame) => this.#link.send(frame),
      changed: () => this.#link.send({ type: 'runner.caps', caps: this.#caps() }),
      updating: () => this.#updates.updating,
    });
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

  /** The link to the server, wired to the hello, the heartbeats, the commands, the turns and the terminals. */
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
      dropped: () => {
        void this.#terminals.closeAll('link_lost');
        this.#turns.linkDown();
      },
    });
  }

  get draining(): boolean {
    return this.#draining;
  }

  /** Takes back the turns on its disk, then connects (its hello names them). */
  start(): void {
    void this.#turns.reattach().then(
      () => {
        if (!this.#stopped) this.#link.start();
      },
      (error: unknown) => {
        this.#options.log.error('could not take back the turns on the disk', { error });
        if (!this.#stopped) this.#link.start();
      },
    );
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#tools.stop();
    await Promise.all([this.#turns.stop(), this.#terminals.stop()]);
    await this.#link.stop();
    await Promise.all([this.#hold.close(), this.#tunnels?.close()]);
  }

  setLiveRuns(count: number): Promise<void> {
    this.#runs = Math.max(0, Math.floor(count));
    return this.#applyLive();
  }

  /** Runs and turns together are the hold's live work (the self-update waits for them too). */
  #applyLive(): Promise<void> {
    return this.#hold.setLiveRuns(this.#runs + this.#turns.live);
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

  /** What it can do now (the hello's and `runner.caps`'s). */
  #caps(): RunnerCaps {
    const { harness, processes, containerId } = this.#options;
    const tools = this.#tools.current;
    return {
      harnesses: harness && processes ? harness.versions : NO_HARNESSES,
      slots: this.#config.slots,
      hold: this.#options.hold.kind,
      power: [...this.#power.providers],
      terminal: this.#terminals.available,
      selfUpdate: this.#updates.available,
      folders: this.#options.folders !== undefined,
      forks: true,
      reattach: harness?.keeper !== undefined && processes !== undefined,
      ...(tools ? { tools } : {}),
      ...(containerId ? { containerId } : {}),
    };
  }

  #hello(): RunnerHello {
    const { harness, version, builtAt, claudeVersion, build } = this.#options;
    // A Claude Code found after the start (a turn looked again) is in the next hello.
    const claude = harness?.versions.claude_code ?? claudeVersion;
    const turns = this.#turns.held();
    return helloOf({
      version,
      builtAt: builtAt ?? null,
      caps: this.#caps(),
      claudeVersion: claude,
      build,
      turns,
    });
  }

  #afterHello(hello: ServerHello): RunnerFrame[] {
    if (hello.machineId !== this.#config.machineId) {
      this.#options.log.warn('the server names another machine than runner.json', {
        configured: this.#config.machineId,
        server: hello.machineId,
      });
    }
    this.#heartbeats.connected();
    this.#turns.connected(hello);
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
