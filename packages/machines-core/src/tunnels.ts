import type { TunnelSpec, TunnelState, TunnelStatus } from '@mwc/shared/runner-protocol';
import type { ProcessCommand } from './driver.ts';
import { clearPort } from './tunnels/clear.ts';
import { frameOf, type Held, stopHeld } from './tunnels/held.ts';
import {
  endText,
  forwardFailure,
  lastLine,
  TUNNEL_CLEAR_RETRY_MS,
  TUNNEL_STABLE_MS,
  TUNNEL_UP_AFTER_MS,
  type TunnelChild,
  type TunnelDeps,
  tunnelKey,
} from './tunnels/process.ts';
import { clearingNote, recovery } from './tunnels/recover.ts';

/**
 * The reverse tunnels' supervisor (`@mwc/machines-core/tunnels`, docs/machines.md "Installing a runner"), shared by a
 * runner that is a power controller (`tunnel.set`) and by the server when it drives the airia CLI itself: one
 * long-lived process per machine that should be linked, from the driver's `tunnelCommand` (the devbox's
 * `gcloud compute ssh` over IAP). Each runs `detached` and is stopped as a process group (gcloud's ssh and IAP helper are
 * its children): SIGTERM, then SIGKILL after 5 s. One that ends while wanted starts again after 5 s, doubling to
 * 5 minutes, from 5 s again after one that stayed up a minute (the Mac bills each process start). Its states
 * (`connecting`, `up` after 10 s alive, `down` with the line that says why: ssh's forward failure, else the last line it
 * printed) go to `report`. A forward failure, or the end of a tunnel that had been up, runs the driver's
 * `clearPortCommand` first and tries again 2 s after it; how often, and the backoff while the machine reads running
 * (30 s at most), are `tunnels/recover.ts`'s. A machine that turns running while its tunnel waits starts it at once.
 */

export {
  forwardFailure,
  lastLine,
  retryDelay,
  retryDelayFor,
  TUNNEL_CLEAR_COOLDOWN_MS,
  TUNNEL_CLEAR_EVERY_MS,
  TUNNEL_CLEAR_RETRY_MS,
  TUNNEL_CLEAR_TIMEOUT_MS,
  TUNNEL_KILL_GRACE_MS,
  TUNNEL_RETRY_INITIAL_MS,
  TUNNEL_RETRY_MAX_MS,
  TUNNEL_RETRY_RUNNING_MAX_MS,
  TUNNEL_STABLE_MS,
  TUNNEL_UP_AFTER_MS,
  type TunnelChild,
  type TunnelDeps,
  type TunnelKill,
  type TunnelLog,
  type TunnelSpawn,
  type TunnelSpawnOptions,
} from './tunnels/process.ts';

/** How much of a tunnel's output is kept (an attempt's standard error) for why it ended. */
const OUTPUT_KEPT = 4096;

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
      if (next !== undefined && tunnelKey(next) === held.key) {
        const turnedRunning = next.running === true && held.tunnel.running !== true;
        held.tunnel = next;
        if (turnedRunning && held.waiting) this.#startNow(held);
        continue;
      }
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
    return [...this.#held.values()].map(frameOf);
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
    held.waiting = false;
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
      this.#ended(held, why);
    };
    // `close` comes once its output is read to the end, so the last line is in.
    child.once('close', (code, signal) =>
      gone(code === null ? `killed by ${signal ?? 'a signal'}` : `exited with code ${code}`),
    );
    child.once('error', (error) => gone(error.message));
    held.timer = this.#deps.timers.setTimeout(() => this.#set(held, 'up', undefined), TUNNEL_UP_AFTER_MS);
  }

  /**
   * Its process ended: done when stopped, else `down` with why, and started again after the wait or after the clearing
   * of the machine's port (`tunnels/recover.ts`).
   */
  #ended(held: Held, why: string): void {
    this.#deps.timers.clearTimeout(held.timer);
    if (held.stopped || this.#closed) {
      held.ended?.();
      return;
    }
    const now = this.#deps.clock.monotonic();
    if (now - held.startedAt >= TUNNEL_STABLE_MS) held.failures = 0;
    const forward = forwardFailure(held.output);
    const error = endText(forward ?? lastLine(held.output) ?? why);
    const { machineId } = held.tunnel;
    const clear = this.#deps.clearPortCommand?.(held.tunnel);
    const next = recovery({
      running: held.tunnel.running === true,
      wasUp: held.state === 'up',
      forward: forward !== undefined,
      canClear: clear !== undefined,
      clearedAt: held.clearedAt,
      failures: held.failures,
      now,
    });
    held.failures++;
    if (next.clear && clear !== undefined) {
      this.#deps.log.warn(clearingNote(forward !== undefined), { machineId, error, clearInMs: next.after });
      this.#set(held, 'down', endText(`${error} (clearing a stale holder of the box's port, then retrying)`));
      if (next.after <= 0) this.#clear(held, clear);
      else held.timer = this.#deps.timers.setTimeout(() => this.#clear(held, clear), next.after);
      return;
    }
    this.#deps.log.warn('a tunnel ended; starting it again later', {
      machineId,
      error,
      retryInMs: next.after,
    });
    this.#set(held, 'down', error);
    held.waiting = true;
    held.timer = this.#deps.timers.setTimeout(() => this.#start(held), next.after);
  }

  /** Clears the machine's port with the driver's command, then starts the tunnel again after 2 s. */
  #clear(held: Held, command: ProcessCommand): void {
    if (held.stopped || this.#closed) return;
    const { machineId } = held.tunnel;
    held.clearedAt = this.#deps.clock.monotonic();
    held.clearing = clearPort(this.#deps, command, () => {
      held.clearing = undefined;
      this.#deps.log.info("cleared a stale holder of the box's port", { machineId });
      held.timer = this.#deps.timers.setTimeout(() => this.#start(held), TUNNEL_CLEAR_RETRY_MS);
    });
  }

  /** Starts a tunnel that waits out its backoff now (its machine just turned running). */
  #startNow(held: Held): void {
    this.#deps.timers.clearTimeout(held.timer);
    this.#deps.log.info('the machine runs; starting its tunnel now', { machineId: held.tunnel.machineId });
    this.#start(held);
  }

  /** Stops a tunnel (`stopHeld`), tracked by machine until its process and a clearing of its port are gone. */
  #stop(held: Held): void {
    const done = stopHeld(this.#deps, held);
    if (done === undefined) return;
    const { machineId } = held.tunnel;
    this.#stopping.set(machineId, done);
    void done.then(() => {
      if (this.#stopping.get(machineId) === done) this.#stopping.delete(machineId);
    });
  }

  #set(held: Held, state: TunnelStatus, error: string | undefined): void {
    held.state = state;
    held.error = error;
    this.#deps.report(frameOf(held));
  }
}
