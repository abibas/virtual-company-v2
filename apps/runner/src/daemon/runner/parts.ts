import { Tunnels } from '@mwc/machines-core/tunnels';
import type {
  RunnerCaps,
  RunnerFrame,
  RunnerHello,
  ServerHello,
  TunnelSpec,
} from '@mwc/shared/runner-protocol';
import { WebSocket } from 'ws';
import { type RunnerConfig, runnerWsUrl } from '../../config.ts';
import { browse } from '../../folders/browse.ts';
import type { HoldManager } from '../../hold/manager.ts';
import { Commands } from '../../link/commands.ts';
import { Link } from '../../link/link.ts';
import type { PowerExecutor } from '../../power/executor.ts';
import type { Clock, Timers } from '../../system/time.ts';
import { TerminalSessions } from '../../terminal/sessions.ts';
import { Tools } from '../../tools/tools.ts';
import { Turns } from '../../turns/turns.ts';
import { Updates } from '../../update/updates.ts';
import type { RunnerOptions } from '../runner.ts';

/**
 * The daemon's parts (`daemon.ts`), each made by a plain function over the daemon's callbacks: a part reaches the
 * others only through them, called later, so the order they are made in does not matter (the link is made last;
 * nothing is sent before the daemon's constructor returns).
 */
export interface DaemonWires {
  readonly options: RunnerOptions;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly power: PowerExecutor;
  /** The configuration now (`key.rotate` replaces it). */
  readonly config: () => RunnerConfig;
  readonly link: () => Link;
  readonly hold: () => HoldManager;
  readonly commands: () => Commands;
  readonly turns: () => Turns;
  readonly terminals: () => TerminalSessions;
  readonly tools: () => Tools;
  readonly updates: () => Updates;
  /** The runs `setLiveRuns` reported. */
  readonly runs: () => number;
  /** Counts runs and turns again as the hold's live work. */
  readonly applyLive: () => void;
  /** `key.rotate`: saves the new key. */
  readonly saveKey: (runnerKey: string) => Promise<void>;
  /** `runner.drain`: no new runs until the runner restarts. */
  readonly drain: () => void;
  /** `tunnel.set`: a power controller's tunnels. */
  readonly setTunnels: (tunnels: readonly TunnelSpec[]) => void;
  /** What it can do now (the hello's and `runner.caps`'s). */
  readonly caps: () => RunnerCaps;
  readonly hello: () => RunnerHello;
  readonly afterHello: (hello: ServerHello) => RunnerFrame[];
  readonly beat: () => Promise<RunnerFrame[]>;
}

const sendOf = (wires: DaemonWires) => (frame: RunnerFrame) => wires.link().send(frame);

/** The server's commands, each handed to the part it is for (and `fs.*` to the folder browser). */
export function makeCommands(wires: DaemonWires): Commands {
  const { options, power } = wires;
  return new Commands({
    setServerHold: (until) => wires.hold().setServerHold(until),
    power,
    saveKey: (runnerKey) => wires.saveKey(runnerKey),
    drain: () => wires.drain(),
    setTunnels: (tunnels) => wires.setTunnels(tunnels),
    terminal: (frame) => wires.terminals().handle(frame),
    turn: (frame) => wires.turns().handle(frame),
    update: (frame) => wires.updates().handle(frame),
    folders: (frame) => browse(options.folders, frame),
    tools: (frame) => wires.tools().handle(frame),
    log: options.log,
  });
}

/** The chat turns: their frames go through the link, a change of their count to the hold. */
export function makeTurns(wires: DaemonWires): Turns {
  const { options, clock, timers } = wires;
  return new Turns({
    host: options.harness,
    processes: options.processes,
    slots: () => wires.config().slots,
    clock,
    timers,
    log: options.log,
    send: sendOf(wires),
    count: () => wires.applyLive(),
  });
}

/** The machine's terminals: their frames go through the link, how many are open to the hold. */
export function makeTerminals(wires: DaemonWires): TerminalSessions {
  const { options, timers } = wires;
  return new TerminalSessions({
    host: options.terminal,
    harness: options.harness,
    timers,
    log: options.log,
    send: sendOf(wires),
    buffered: () => wires.link().bufferedAmount,
    count: (open) => void wires.hold().setTerminals(open),
  });
}

/** The self-update: it waits for runs, terminals and an install, not for turns. */
export function makeUpdates(wires: DaemonWires): Updates {
  const { options, timers } = wires;
  return new Updates({
    update: options.update,
    serverUrl: () => wires.config().serverUrl,
    // Chat turns outlive the restart (S5.4): only runs and terminals would end with it.
    liveRuns: () => wires.runs(),
    openTerminals: () => wires.terminals().open,
    installing: () => wires.tools().installing,
    closeTerminals: (notice) => wires.terminals().closeAll('runner_updating', notice),
    timers,
    log: options.log,
  });
}

/** The machine's tools: their output and a change of them (`runner.caps`) go through the link. */
export function makeTools(wires: DaemonWires): Tools {
  const { tools, processes, harness, log } = wires.options;
  const { timers } = wires;
  return new Tools({
    ...{ host: tools?.host, found: tools?.found, processes, harness, timers, log },
    send: sendOf(wires),
    changed: () => wires.link().send({ type: 'runner.caps', caps: wires.caps() }),
    updating: () => wires.updates().updating,
  });
}

/** A power controller's tunnels (`tunnel.set`), reported through the link; none without power or processes. */
export function controllerTunnels(wires: DaemonWires): Tunnels | undefined {
  const { options, power, clock, timers } = wires;
  const { processes, log } = options;
  if (power.providers.length === 0 || processes === undefined) return undefined;
  return new Tunnels({
    command: (tunnel) => power.tunnelCommand?.(tunnel),
    clearPortCommand: power.clearPortCommand?.bind(power),
    ...processes,
    clock,
    timers,
    log,
    report: (state) => wires.link().send(state),
  });
}

/** The link to the server, wired to the hello, the heartbeats, the commands, the turns and the terminals. */
export function makeLink(wires: DaemonWires): Link {
  const { options, clock, timers } = wires;
  return new Link({
    url: runnerWsUrl(options.config.serverUrl),
    key: () => wires.config().runnerKey,
    WebSocket: options.WebSocket ?? WebSocket,
    clock,
    timers,
    random: options.random ?? Math.random,
    log: options.log,
    hello: () => wires.hello(),
    afterHello: (hello) => wires.afterHello(hello),
    beat: () => wires.beat(),
    handle: (frame) => wires.commands().handle(frame),
    refuse: (text, why) => wires.commands().refuse(text, why),
    dropped: () => {
      void wires.terminals().closeAll('link_lost');
      wires.turns().linkDown();
    },
  });
}
