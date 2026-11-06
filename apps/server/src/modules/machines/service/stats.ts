import type { Machine, MachineSampleRow, RunnerSession, TenantDb } from '@mwc/db';
import { samplesRepo } from '../repo/samples.ts';
import { sessionsRepo } from '../repo/sessions.ts';
import { machinesRepo } from '../repo.ts';
import {
  DAY_MS,
  type MachineStats,
  machineStats,
  type Segment,
  type SessionSpan,
  type StatSample,
  WEEK_MS,
} from '../rules/stats.ts';
import type { MachineStatsListView, MachineStatsView } from '../schemas/stats.ts';

const repo = machinesRepo();
const iso = (ms: number) => new Date(ms).toISOString();
const segmentsView = (segments: readonly Segment[]) =>
  segments.map((segment) => ({ from: iso(segment.from), to: iso(segment.to), up: segment.up }));

/** Rows grouped by their machine. */
function byMachine<R extends { readonly machineId: string }>(rows: readonly R[]): Map<string, R[]> {
  const groups = new Map<string, R[]>();
  for (const row of rows) groups.set(row.machineId, [...(groups.get(row.machineId) ?? []), row]);
  return groups;
}

const statSample = (row: MachineSampleRow): StatSample => ({ ...row, at: row.at.getTime() });
const span = (row: RunnerSession): SessionSpan => ({
  connectedAt: row.connectedAt.getTime(),
  disconnectedAt: row.disconnectedAt?.getTime() ?? null,
});

function statsView(machine: Machine, stats: MachineStats): MachineStatsView {
  const { now } = stats;
  return {
    machineId: machine.id,
    name: machine.name,
    kind: machine.kind,
    provider: machine.provider,
    status: machine.status,
    lastSeenAt: machine.lastSeenAt?.toISOString() ?? null,
    now: now === null ? null : { ...now, at: iso(now.at) },
    upSince: stats.upSince === null ? null : iso(stats.upSince),
    runtime: stats.runtime,
    agentRuns24hMs: stats.agentRuns24hMs,
    series: stats.series.map((point) => ({ at: iso(point.at), loadPerCpu: point.loadPerCpu })),
    upDown: { h24: segmentsView(stats.upDown.h24), d7: segmentsView(stats.upDown.d7) },
    overloaded: stats.overloaded,
  };
}

/**
 * The home board's row for every machine of the company at `now` (`rules/stats.ts`): the samples of the last 24 hours
 * and the sessions of the last 7 days (with any still open, however old), read once for all machines.
 */
export async function machineStatsList(t: TenantDb, now: Date): Promise<MachineStatsListView> {
  const nowMs = now.getTime();
  const machines = await repo.list(t);
  const samples = byMachine(await samplesRepo.since(t, new Date(nowMs - DAY_MS)));
  const sessions = byMachine(await sessionsRepo.since(t, new Date(nowMs - WEEK_MS)));
  return {
    at: now.toISOString(),
    machines: machines.map((machine) =>
      statsView(
        machine,
        machineStats({
          samples: (samples.get(machine.id) ?? []).map(statSample),
          sessions: (sessions.get(machine.id) ?? []).map(span),
          online: machine.status !== 'offline',
          nowMs,
        }),
      ),
    ),
  };
}
