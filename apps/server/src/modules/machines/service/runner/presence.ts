import type { TenantDb } from '@mwc/db';
import type { HoldSource } from '@mwc/shared/enums';
import type { MachineSample } from '@mwc/shared/machines';
import { samplesRepo } from '../../repo/samples.ts';
import { sessionsRepo } from '../../repo/sessions.ts';
import { machinesRepo } from '../../repo.ts';
import { endOfLostSession, sampleMinute } from '../../rules.ts';

/**
 * What a runner's connection writes about its machine (S4.2), each in the machine's company: online with a new
 * session on its hello, the last sign of life and the minute's sample on each heartbeat, the hold it reports, offline
 * when it closes, and the sweep's offline for a lease that lapsed. The hub runs these one after the other per machine.
 */

const repo = machinesRepo();

/** A runner session as its connection remembers it. */
export interface OpenSession {
  readonly id: string;
  readonly connectedAt: Date;
}

/** Ends the machine's sessions still open (a crash, a replaced connection) at its last sign of life. */
async function endLostSessions(tx: TenantDb, machineId: string, lastSeenAt: Date | null): Promise<void> {
  for (const session of await sessionsRepo.openOf(tx, machineId)) {
    await sessionsRepo.close(tx, session.id, endOfLostSession(session.connectedAt, lastSeenAt));
  }
}

/**
 * A runner's hello was accepted: the sessions it left open end, a new one starts, and the machine is online with the
 * runner's version, its slots and (when the hello says) Claude Code's version.
 */
export function online(
  t: TenantDb,
  machineId: string,
  hello: {
    readonly version: string;
    readonly claudeVersion?: string | null | undefined;
    readonly slots: number;
    readonly remoteIp: string | null;
    readonly now: Date;
  },
): Promise<OpenSession> {
  return t.transaction(async (tx) => {
    const machine = await repo.get(tx, machineId);
    await endLostSessions(tx, machineId, machine?.lastSeenAt ?? null);
    const session = await sessionsRepo.insert(tx, {
      machineId,
      connectedAt: hello.now,
      version: hello.version,
      remoteIp: hello.remoteIp,
    });
    await repo.update(tx, machineId, {
      status: 'online',
      lastSeenAt: hello.now,
      runnerVersion: hello.version,
      slots: hello.slots,
      ...(hello.claudeVersion === undefined ? {} : { claudeVersion: hello.claudeVersion }),
    });
    return { id: session.id, connectedAt: session.connectedAt };
  });
}

/**
 * A runner said what it can do again (`runner.caps`): its slots and, when it says, Claude Code's version (null when it
 * has none now).
 */
export async function capsChanged(
  t: TenantDb,
  machineId: string,
  caps: { readonly slots: number; readonly claudeVersion: string | null | undefined },
): Promise<void> {
  const { slots, claudeVersion } = caps;
  await repo.update(t, machineId, { slots, ...(claudeVersion === undefined ? {} : { claudeVersion }) });
}

/** A runner too old for the server said hello: its version is recorded, so its page can say it needs an update. */
export async function tooOld(t: TenantDb, machineId: string, version: string): Promise<void> {
  await repo.update(t, machineId, { runnerVersion: version });
}

/** A heartbeat: the machine's last sign of life, and its sample under the sample's minute. */
export async function heartbeat(
  t: TenantDb,
  machineId: string,
  now: Date,
  sample: MachineSample | undefined,
): Promise<void> {
  await repo.seen(t, machineId, now);
  if (sample !== undefined) await samplesRepo.upsert(t, machineId, sampleMinute(sample.at, now), sample);
}

/** The hold the runner applies now (`hold.state`). */
export async function hold(
  t: TenantDb,
  machineId: string,
  until: number | null,
  source: HoldSource,
): Promise<void> {
  await repo.update(t, machineId, { holdUntil: until === null ? null : new Date(until), holdSource: source });
}

/**
 * The connection closed: its session ends (never before it began), and the machine goes offline unless a newer
 * connection took over (`current` false).
 */
export function offline(
  t: TenantDb,
  machineId: string,
  session: OpenSession | undefined,
  current: boolean,
  now: Date,
): Promise<void> {
  return t.transaction(async (tx) => {
    if (session !== undefined) {
      await sessionsRepo.close(tx, session.id, now > session.connectedAt ? now : session.connectedAt);
    }
    if (current) await repo.offline(tx, machineId);
  });
}

/**
 * The sweep: a machine still marked online whose runner has said nothing since before `cutoff` (its lease lapsed, e.g.
 * the server crashed with its socket open) goes offline, its open sessions ending at its last sign of life. False when a
 * heartbeat came in the meantime.
 */
export function lapsed(t: TenantDb, machineId: string, cutoff: Date): Promise<boolean> {
  return t.transaction(async (tx) => {
    const machine = await repo.get(tx, machineId);
    const stale =
      machine?.status === 'online' && (machine.lastSeenAt === null || machine.lastSeenAt < cutoff);
    if (!stale) return false;
    await endLostSessions(tx, machineId, machine.lastSeenAt);
    await repo.offline(tx, machineId);
    return true;
  });
}
