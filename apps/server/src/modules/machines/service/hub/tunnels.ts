import {
  encodeFrame,
  type TunnelSpec,
  type TunnelState,
  type TunnelStatus,
} from '@mwc/shared/runner-protocol';
import { tunnelSetKey } from '../../rules/tunnels.ts';
import type { RunnerConnection } from '../connection.ts';

/**
 * The hub's memory of the power controllers' tunnels (docs/runner-protocol.md, "Hold and power"): the `tunnel.set`
 * last sent on each connection, so a set goes out only when it changed (a new connection has had none), and the latest
 * `tunnel.state` reported for each machine, under the reporter's company. Memory only: after a restart every
 * controller reconnects, gets its set and reports its tunnels again.
 */

/** The latest state reported for a machine's tunnel. */
export interface TunnelReport {
  readonly state: TunnelStatus;
  readonly error: string | null;
  /** When the tunnel entered this state, as this server saw it. */
  readonly since: Date;
  /** The machine whose runner reported it: the box's controller at the time. */
  readonly reportedBy: string;
}

/** The hub's side of the tunnels (`hub.tunnels`). */
export interface HubTunnels {
  /** Sends the machine's runner the full set to hold, unless its connection got this set last; true when sent. */
  set(machineId: string, tunnels: readonly TunnelSpec[]): boolean;
  /** The latest state reported for a machine of the company, or undefined. */
  report(companyId: string, machineId: string): TunnelReport | undefined;
}

/** The memory on the hub's clock and its ready connections; `record` is the connections' `tunnel.state` callback. */
export function tunnelBoard(clock: () => Date, ready: (machineId: string) => RunnerConnection | undefined) {
  const reports = new Map<string, TunnelReport>();
  const sent = new WeakMap<RunnerConnection, string>();
  const at = (companyId: string, machineId: string) => `${companyId}/${machineId}`;
  const api: HubTunnels = {
    set(machineId, tunnels) {
      const connection = ready(machineId);
      const key = tunnelSetKey(tunnels);
      if (connection === undefined || sent.get(connection) === key) return false;
      sent.set(connection, key);
      connection.link.send(encodeFrame({ type: 'tunnel.set', tunnels: [...tunnels] }));
      return true;
    },
    report: (companyId, machineId) => reports.get(at(companyId, machineId)),
  };
  /** Keeps a report; `since` moves only when the state or the machine reporting it changes. */
  const record = (connection: RunnerConnection, frame: TunnelState): void => {
    const key = at(connection.runner.companyId, frame.machineId);
    const before = reports.get(key);
    const reportedBy = connection.machineId;
    const same = before?.state === frame.state && before.reportedBy === reportedBy;
    const since = same ? before.since : clock();
    reports.set(key, { state: frame.state, error: frame.error ?? null, since, reportedBy });
  };
  return { api, record };
}
