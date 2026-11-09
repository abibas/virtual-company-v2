import type { TunnelSpec, TunnelState, TunnelStatus } from '@mwc/shared/runner-protocol';
import {
  endText,
  lastLine,
  retryDelay,
  TUNNEL_KILL_GRACE_MS,
  TUNNEL_STABLE_MS,
  TUNNEL_UP_AFTER_MS,
  type TunnelChild,
  type TunnelDeps,
  tunnelKey,
} from './tunnels/process.ts';

/**
 * The reverse tunnels' supervisor (`@mwc/machines-core/tunnels`, docs/machines.md "Installing a runner"), shared by a
 * runner that is a power controller (`tunnel.set`) and by the server when it drives the airia CLI itself: one
 * long-lived process per machine that should be linked, from the driver's `tunnelCommand` (the devbox's
 * `gcloud compute ssh` over IAP). Each runs `detached` and is stopped as a process group (gcloud's ssh and IAP helper are
 * its children): SIGTERM, then SIGKILL after 5 s. One that ends while wanted starts again after 5 s, doubling to
 * 5 minutes, from 5 s again after one that stayed up a minute (the Mac bills each process start). Its states
 * (`connecting`, `up` after 10 s alive, `down` with the last line it printed) go to `report`.
 */

export {
  lastLine,
  retryDelay,
  TUNNEL_KILL_GRACE_MS,
  TUNNEL_RETRY_INITIAL_MS,
  TUNNEL_RETRY_MAX_MS,
  TUNNEL_STABLE_MS,
  TUNNEL_UP_AFTER_MS,
  type TunnelChild,
  type TunnelDeps,
  type TunnelKill,
  type TunnelLog,
  type TunnelSpawn,
  type TunnelSpawnOptions,
} from './tunnels/process.ts';

/** How much of a tunnel's output is kept for its last line. */
const OUTPUT_KEPT = 4096;

interface Held {
  readonly tunnel: TunnelSpec;
  readonly key: string;
  state: TunnelStatus;
  error?: string | undefined;
  child?: TunnelChild | undefined;
  startedAt: number;
  output: string;
  /** Failures in a row, for the wait before the next start. */
  failures: number;
  /** The up timer while starting, the retry timer while down. */
  timer?: unknown;
  stopped: boolean;
  /** Called once its process ended after a stop. */
  ended?: () => void;
}

export class Tunnels {
  readonly #deps: TunnelDeps;
  readonly #held = new Map<string, Held>();
  /** Tunnels being stopped, by machine: a new one for the machine starts once the old one is gone. */
  readonly #stopping = new Map<string, Promise<void>>();
  #closed = false;

  constructor(deps: TunnelDeps) {
    this.#deps = deps;
  }

  /** Reconciles the full set wanted: starts the missing, stops the extra, restarts the changed. */
  set(tunnels: readonly TunnelSpec[]): void {
    if (this.#closed) return;
    const wanted = new Map(tunnels.map((tunnel) => [tunnel.machineId, tunnel]));
    for (const [machineId, held] of this.#held) {
      const next = wanted.get(machineId);
      if (next !== undefined && tunnelKey(next) === held.key) continue;
      const why = next === undefined ? 'stopping a tunnel' : 'restarting a tunnel for its new target';
      this.#deps.log.info(why, { machineId });
      this.#held.delete(machineId);
      this.#stop(held);
    }
    for (const tunnel of wanted.values()) {
      if (this.#held.has(tunnel.machineId)) continue;
      const held: Held = {
        tunnel,
        key: tunnelKey(tunnel),
        state: 'connecting',
        startedAt: 0,
        output: '',
        failures: 0,
        stopped: false,
      };
      this.#held.set(tunnel.machineId, held);
      const before = this.#stopping.get(tunnel.machineId);
      if (before === undefined) this.#start(held);
      else void before.then(() => this.#start(held));
    }
  }

  /** Every tunnel's state now, for after a hello. */
  states(): TunnelState[] {
    return [...this.#held.values()].map((held) => this.#frame(held));
  }

  /** Stops every tunnel and resolves once each process ended (or got SIGKILL); nothing starts afterwards. */
  async close(): Promise<void> {
    this.#closed = true;
    const held = [...this.#held.values()];
    this.#held.clear();
    for (const one of held) this.#stop(one);
    await Promise.all(this.#stopping.values());
  }

  /** Starts its process: `connecting` (with the last error after a failure), `up` after 10 s alive. */
  #start(held: Held): void {
    if (this.#closed || held.stopped) return;
    const { machineId } = held.tunnel;
    const command = this.#deps.command(held.tunnel);
    if (command === undefined) {
      this.#deps.log.warn('this runner cannot hold a tunnel to the machine', { machineId });
      this.#set(held, 'down', 'this runner cannot hold a tunnel to this machine');
      return;
    }
    held.output = '';
    held.startedAt = this.#deps.clock.monotonic();
    let child: TunnelChild;
    try {
      const env = command.env === undefined ? {} : { env: command.env };
      child = this.#deps.spawn(command.command, command.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
        ...env,
      });
    } catch (error) {
      this.#ended(held, (error as Error).message);
      return;
    }
    this.#deps.log.info('starting a tunnel', { machineId, pid: child.pid });
    held.child = child;
    this.#set(held, 'connecting', held.error);
    child.stderr?.on('data', (chunk) => {
      held.output = (held.output + String(chunk)).slice(-OUTPUT_KEPT);
    });
    const gone = (why: string) => {
      if (held.child !== child) return;
      held.child = undefined;
      this.#ended(held, lastLine(held.output) ?? why);
    };
    // `close` comes once its output is read to the end, so the last line is in.
    child.once('close', (code, signal) =>
      gone(code === null ? `killed by ${signal ?? 'a signal'}` : `exited with code ${code}`),
    );
    child.once('error', (error) => gone(error.message));
    held.timer = this.#deps.timers.setTimeout(() => this.#set(held, 'up', undefined), TUNNEL_UP_AFTER_MS);
  }

  /** Its process ended: done when stopped, else `down` with why and started again after the wait. */
  #ended(held: Held, why: string): void {
    this.#deps.timers.clearTimeout(held.timer);
    if (held.stopped || this.#closed) {
      held.ended?.();
      return;
    }
    if (this.#deps.clock.monotonic() - held.startedAt >= TUNNEL_STABLE_MS) held.failures = 0;
    const delay = retryDelay(held.failures);
    held.failures++;
    const error = endText(why);
    const { machineId } = held.tunnel;
    this.#deps.log.warn('a tunnel ended; starting it again later', { machineId, error, retryInMs: delay });
    this.#set(held, 'down', error);
    held.timer = this.#deps.timers.setTimeout(() => this.#start(held), delay);
  }

  /** Stops a tunnel: its group gets SIGTERM, then SIGKILL after the grace; tracked until its process is gone. */
  #stop(held: Held): void {
    held.stopped = true;
    this.#deps.timers.clearTimeout(held.timer);
    const pid = held.child?.pid;
    if (pid === undefined) return;
    const { machineId } = held.tunnel;
    const done = new Promise<void>((resolve) => {
      const kill = this.#deps.timers.setTimeout(() => {
        this.#deps.log.warn('a tunnel did not stop in time; killing it', { machineId, pid });
        this.#deps.killGroup(pid, 'SIGKILL');
        resolve();
      }, TUNNEL_KILL_GRACE_MS);
      held.ended = () => {
        this.#deps.timers.clearTimeout(kill);
        resolve();
      };
      this.#deps.killGroup(pid, 'SIGTERM');
    });
    this.#stopping.set(machineId, done);
    void done.then(() => {
      if (this.#stopping.get(machineId) === done) this.#stopping.delete(machineId);
    });
  }

  #set(held: Held, state: TunnelStatus, error: string | undefined): void {
    held.state = state;
    held.error = error;
    this.#deps.report(this.#frame(held));
  }

  #frame({ tunnel, state, error }: Held): TunnelState {
    return { type: 'tunnel.state', machineId: tunnel.machineId, state, ...(error ? { error } : {}) };
  }
}
