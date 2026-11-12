import type { TunnelSpec, TunnelState, TunnelStatus } from '@mwc/shared/runner-protocol';
import type { Clearing } from './clear.ts';
import { TUNNEL_KILL_GRACE_MS, type TunnelChild, type TunnelDeps } from './process.ts';

/**
 * One tunnel the supervisor (`../tunnels.ts`) holds, its `tunnel.state` frame, and its stop: SIGTERM to its process
 * group, SIGKILL after 5 s, with a clearing of the machine's port stopped with it.
 */

export interface Held {
  /** Its spec, the latest `running` included. */
  tunnel: TunnelSpec;
  readonly key: string;
  state: TunnelStatus;
  error?: string | undefined;
  child?: TunnelChild | undefined;
  startedAt: number;
  output: string;
  /** Failures in a row, for the wait before the next start. */
  failures: number;
  /** The up timer while starting, the retry (or clearing) timer while down. */
  timer?: unknown;
  /** While it waits to start again after the backoff (not a clearing): true. */
  waiting?: boolean;
  /** The clearing of the machine's port, while it runs. */
  clearing?: Clearing | undefined;
  /** When it last cleared the machine's port (monotonic). */
  clearedAt?: number | undefined;
  stopped: boolean;
  /** Called once its process ended after a stop. */
  ended?: () => void;
}

/** Its state as the protocol's `tunnel.state` says it. */
export const frameOf = ({ tunnel, state, error }: Held): TunnelState => ({
  type: 'tunnel.state',
  machineId: tunnel.machineId,
  state,
  ...(error ? { error } : {}),
});

/** SIGTERM to its group, SIGKILL after the grace; resolves once its process is gone. */
function kill(deps: TunnelDeps, held: Held, pid: number): Promise<void> {
  const { machineId } = held.tunnel;
  return new Promise<void>((resolve) => {
    const timer = deps.timers.setTimeout(() => {
      deps.log.warn('a tunnel did not stop in time; killing it', { machineId, pid });
      deps.killGroup(pid, 'SIGKILL');
      resolve();
    }, TUNNEL_KILL_GRACE_MS);
    held.ended = () => {
      deps.timers.clearTimeout(timer);
      resolve();
    };
    deps.killGroup(pid, 'SIGTERM');
  });
}

/**
 * Stops a tunnel: its timer goes, a clearing of its port is stopped, its group gets SIGTERM, then SIGKILL after the
 * grace. Resolves once its process (and the clearing) are gone; undefined when nothing runs.
 */
export function stopHeld(deps: TunnelDeps, held: Held): Promise<void> | undefined {
  held.stopped = true;
  deps.timers.clearTimeout(held.timer);
  const waits: Promise<void>[] = [];
  if (held.clearing !== undefined) {
    held.clearing.stop();
    waits.push(held.clearing.ended);
  }
  const pid = held.child?.pid;
  if (pid !== undefined) waits.push(kill(deps, held, pid));
  return waits.length === 0 ? undefined : Promise.all(waits).then(() => undefined);
}
