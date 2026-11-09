import type { DbHandle, Machine, TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import type { MachinePowerPolicy, PowerAction } from '@mwc/shared/machines';
import { roleAtLeast } from '@mwc/shared/roles';
import type { PowerArgs } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import { profilesOf } from '../../identity/service.ts';
import { powerRepo } from '../repo/power.ts';
import { machinesRepo } from '../repo.ts';
import { isPowered, type PowerActor, policyText } from '../rules/power.ts';
import { MACHINE_NOT_FOUND, type Refusal } from '../rules.ts';
import type { MachinePowerView, PowerEventView } from '../schemas/power.ts';
import type { RunnerHub } from './hub.ts';
import type { PowerControl } from './power/control.ts';
import type { Controlled, ControlRefusal } from './power/controller.ts';
import { refreshHold } from './power/hold.ts';
import { logPower, nextBox, readPower, saveFailure, saveReading, saveState } from './power/store.ts';

/**
 * The power API's logic (docs/machines.md, S4.4b): a machine's power view, its policy, Start and Stop of a devbox
 * through its controller (this server's own driver or a runner controller: `power/control.ts`), the box's time zone,
 * and the power log. Every change is a `machine_power_events` row naming the person (`user:<user id>`). The scheduler
 * is `power/scheduler.ts`.
 */

export interface PowerDeps {
  readonly db: DbHandle;
  readonly hub: RunnerHub;
  readonly logger: Logger;
  readonly clock: () => Date;
  /** Who drives the devboxes: this server, or their runner controllers. */
  readonly control: PowerControl;
}

/** Who acts: their principal and user, their role here. */
export interface PowerCaller {
  readonly principalId: string;
  readonly userId: string;
  readonly role: MembershipRole;
}

type Done = { readonly ok: true; readonly power: MachinePowerView };

const repo = machinesRepo();
const userActor = (caller: PowerCaller): PowerActor => `user:${caller.userId}`;

const TEXT = {
  start: { done: 'started', reason: 'Started by hand', failed: 'Starting the box failed' },
  stop: { done: 'stopped', reason: 'Stopped by hand', failed: 'Stopping the box failed' },
} as const;

/** The machine's power as the API shows it, read again (a command may have saved its controller). */
async function viewOf(
  control: PowerControl,
  t: TenantDb,
  machineId: string,
  role: MembershipRole,
): Promise<MachinePowerView> {
  const machine = (await repo.get(t, machineId)) as Machine;
  const { policy, state } = await readPower(t, machineId);
  const { holdUntil, holdReason, autoStartedWindow, manualStopAt, lastTurnAt } = state;
  return {
    policy,
    state: { holdUntil, holdReason, autoStartedWindow, manualStopAt, lastTurnAt },
    box: isPowered(machine) ? nextBox(state.box) : null,
    controller: await control.describe(t, machine),
    canControl: roleAtLeast(role, 'admin'),
  };
}

/** Runs one power action on the devbox through its controller, keeps what it read (or why it failed), syncs tunnels. */
async function control(
  deps: PowerDeps,
  t: TenantDb,
  machine: Machine,
  action: PowerAction,
  args?: PowerArgs,
): Promise<Controlled> {
  const controller = await deps.control.resolve(t, machine);
  if (!controller.ok) return controller;
  const result = await controller.run(action, args);
  const { state } = await readPower(t, machine.id);
  if (result.ok) {
    await saveReading(t, machine, state.box, result.reading, deps.clock());
    await deps.control.syncTunnels(t, controller.machineId);
  } else if (result.status === 502) {
    await saveFailure(
      t,
      machine.id,
      state.box,
      { code: result.driverCode, message: result.detail },
      deps.clock(),
    );
  }
  return result;
}

async function setPolicy(
  deps: PowerDeps,
  t: TenantDb,
  caller: PowerCaller,
  machineId: string,
  policy: MachinePowerPolicy,
): Promise<Done | Refusal<404>> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const at = deps.clock();
  await powerRepo.setPolicy(t, machine.id, policy, caller.principalId);
  await logPower(t, machine.id, {
    action: 'policy',
    reason: policyText(policy),
    actor: userActor(caller),
    at,
  });
  await refreshHold(deps, t, machine, at);
  return { ok: true, power: await viewOf(deps.control, t, machine.id, caller.role) };
}

/** Start or Stop by hand: a Stop is remembered, so auto-start leaves the box off for the rest of its window. */
async function power(
  deps: PowerDeps,
  t: TenantDb,
  caller: PowerCaller,
  machineId: string,
  action: 'start' | 'stop',
): Promise<Done | Refusal<404> | ControlRefusal> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const result = await control(deps, t, machine, action);
  const at = deps.clock();
  const actor = userActor(caller);
  if (!result.ok) {
    if (result.status === 502) {
      await logPower(t, machine.id, {
        action: 'failed',
        reason: `${TEXT[action].failed}: ${result.detail}`,
        actor,
        at,
      });
    }
    return result;
  }
  if (action === 'stop') await saveState(t, machine.id, { manualStopAt: at.toISOString() });
  await logPower(t, machine.id, { action: TEXT[action].done, reason: TEXT[action].reason, actor, at });
  return { ok: true, power: await viewOf(deps.control, t, machine.id, caller.role) };
}

/** Sets the box's own time zone (`devbox-tz`), which its idle and nightly rules use. */
async function setTimezone(
  deps: PowerDeps,
  t: TenantDb,
  caller: PowerCaller,
  machineId: string,
  timezone: string,
): Promise<Done | Refusal<404> | ControlRefusal> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const result = await control(deps, t, machine, 'set_timezone', { timezone });
  const at = deps.clock();
  const actor = userActor(caller);
  if (!result.ok) {
    if (result.status === 502) {
      const reason = `Setting the box's time zone to ${timezone} failed: ${result.detail}`;
      await logPower(t, machine.id, { action: 'failed', reason, actor, at });
    }
    return result;
  }
  await logPower(t, machine.id, {
    action: 'timezone',
    reason: `The box's time zone is now ${timezone}`,
    actor,
    at,
  });
  return { ok: true, power: await viewOf(deps.control, t, machine.id, caller.role) };
}

/** The machine's last `limit` power events, newest first, each person named from their profile. */
async function events(
  deps: PowerDeps,
  t: TenantDb,
  machineId: string,
  limit: number,
): Promise<{ readonly ok: true; readonly events: PowerEventView[] } | Refusal<404>> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const rows = await powerRepo.events(t, machine.id, limit);
  const userOf = (actor: string) => (actor.startsWith('user:') ? actor.slice('user:'.length) : undefined);
  const userIds = [...new Set(rows.flatMap((row) => userOf(row.actor) ?? []))];
  const people = userIds.length === 0 ? new Map() : await profilesOf(deps.db, userIds);
  const nameOf = (actor: string) => {
    const person = people.get(userOf(actor) ?? '');
    return person === undefined ? null : (person.displayName ?? person.primaryEmail);
  };
  return {
    ok: true,
    events: rows.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      actor: row.actor,
      actorName: nameOf(row.actor),
      at: row.at.toISOString(),
    })),
  };
}

/** The power API's operations, on the server's database, hub, logger and clock. */
export function powerService(deps: PowerDeps) {
  return {
    async view(t: TenantDb, machineId: string, role: MembershipRole): Promise<Done | Refusal<404>> {
      const machine = await repo.get(t, machineId);
      if (machine === undefined) return MACHINE_NOT_FOUND;
      return { ok: true, power: await viewOf(deps.control, t, machine.id, role) };
    },
    setPolicy: (t: TenantDb, caller: PowerCaller, machineId: string, policy: MachinePowerPolicy) =>
      setPolicy(deps, t, caller, machineId, policy),
    power: (t: TenantDb, caller: PowerCaller, machineId: string, action: 'start' | 'stop') =>
      power(deps, t, caller, machineId, action),
    setTimezone: (t: TenantDb, caller: PowerCaller, machineId: string, timezone: string) =>
      setTimezone(deps, t, caller, machineId, timezone),
    events: (t: TenantDb, machineId: string, limit: number) => events(deps, t, machineId, limit),
  };
}

export type PowerService = ReturnType<typeof powerService>;
