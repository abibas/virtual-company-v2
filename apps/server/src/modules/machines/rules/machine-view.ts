import type { Machine } from '@mwc/db';
import type { LogoRef } from '@mwc/shared/logos';
import type { MachineView, TunnelView } from '../schemas.ts';
import type { RunnerFacts } from './runner.ts';

/** A machine's row as the machines API shows it (pure; `service.ts` gathers its counts, tunnel, logo and runner). */

const iso = (at: Date | null) => at?.toISOString() ?? null;

/**
 * A machine as the API shows it, with how many agents not archived run on it by default (`agentCount`), for a devbox
 * its tunnel as its controller reported it (the power control's `tunnelOf`), its logo's version (null without one) and
 * its runner as the hub knows it (`runner`: its build against the served one).
 */
export function machineView(
  row: Machine,
  agentCount: number,
  tunnel: TunnelView | null,
  logo: LogoRef | null,
  runner: RunnerFacts,
): MachineView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    providerRef: row.providerRef ?? null,
    controllerMachineId: row.controllerMachineId,
    os: row.os,
    arch: row.arch,
    hostname: row.hostname,
    unixUser: row.unixUser,
    versions: { runner: row.runnerVersion, claude: row.claudeVersion },
    slots: row.slots,
    status: row.status,
    lastSeenAt: iso(row.lastSeenAt),
    hold: { until: iso(row.holdUntil), source: row.holdSource },
    hourlyCost: row.hourlyCost,
    agentCount,
    tunnel,
    runner,
    logo,
    createdAt: row.createdAt.toISOString(),
  };
}
