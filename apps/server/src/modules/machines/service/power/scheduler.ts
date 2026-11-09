import { type DbHandle, type Machine, type TenantDb, tenant } from '@mwc/db';
import type { Logger } from 'pino';
import { presentMachines } from '../../repo/upkeep.ts';
import { alreadyText } from '../../rules/power/text.ts';
import { type BoxState, decide, isPowered, type PowerDecision, type PowerState } from '../../rules/power.ts';
import type { RunnerHub } from '../runner/hub.ts';
import { type Controller, controlOf, type PowerControl } from './control.ts';
import { applyHold } from './hold.ts';
import { logPower, readPower, saveFailure, saveReading, saveState } from './store.ts';

/**
 * The power scheduler (docs/machines.md, "The choice"): a step at most once a minute (the machines' jobs) decides
 * every machine's hold and sends it when it changes; for a devbox it starts the box at its keep-on hours, stops it when
 * they end, and reads its status through its controller (this server's own driver, or a runner controller:
 * `control.ts`) at most every 5 minutes. Starts, stops and readings take up to minutes, so they run after the step, one
 * at a time per machine; `idle()` waits for them. What it decided is in the rows, so a step after a restart takes up
 * where the last one left off. It also keeps the tunnels in step with what it read: this server's own, or every
 * connected runner controller's (with the server's port; the hub sends only a changed set).
 */

/** How often a box's status is read through its controller. */
export const BOX_CHECK_MS = 5 * 60_000;

/** What one step did. */
export interface PowerStep {
  /** Machines decided. */
  readonly machines: number;
  /** Holds that changed (sent to their runners when connected). */
  readonly holds: number;
  /** Starts, stops and readings begun. */
  readonly commands: number;
}

export interface PowerScheduler {
  /** Decides every machine at `now`; resolves once the decisions are saved (the commands go on after). */
  step(now: Date): Promise<PowerStep>;
  /** Resolves once every command begun so far is done. */
  idle(): Promise<void>;
}

export interface SchedulerDeps {
  readonly db: DbHandle;
  readonly hub: RunnerHub;
  readonly logger: Logger;
  readonly clock: () => Date;
  /** The server's own port, for the runner controllers' tunnels; without it (and without `control`) none are sent. */
  readonly port?: number | undefined;
  /** Who drives the devboxes; their runner controllers when left out. */
  readonly control?: PowerControl | undefined;
}

/** True when the box was never read, or not for `BOX_CHECK_MS`. */
export function boxCheckDue(box: BoxState | null, now: Date): boolean {
  const checkedAt = box?.checkedAt ?? null;
  return checkedAt === null || now.getTime() - Date.parse(checkedAt) >= BOX_CHECK_MS;
}

type Work = (t: TenantDb, machine: Machine, controller: Controller) => Promise<void>;
type Deps = SchedulerDeps & { readonly control: PowerControl };

/** A start or stop the scheduler decided, run through the controller and logged as the schedule's. */
function powerWork(deps: Deps, action: 'start' | 'stop', reason: string): Work {
  return async (t, machine, controller) => {
    const result = await controller.run(action);
    const { state } = await readPower(t, machine.id);
    const at = deps.clock();
    if (result.ok) {
      await saveReading(t, machine, state.box, result.reading, at);
      await deps.control.syncTunnels(t, controller.machineId);
      await logPower(t, machine.id, {
        action: action === 'start' ? 'started' : 'stopped',
        reason: result.already ? alreadyText(reason, action) : reason,
        actor: 'schedule',
        at,
      });
      return;
    }
    if (result.status === 502) {
      await saveFailure(t, machine.id, state.box, { code: result.driverCode, message: result.detail }, at);
    }
    const why = result.status === 502 ? result.detail : result.message;
    await logPower(t, machine.id, {
      action: 'failed',
      reason: `${reason}, but the ${action} failed: ${why}`,
      actor: 'schedule',
      at,
    });
  };
}

/** A routine reading of the box: kept in the state, never logged. */
function checkWork(deps: Deps): Work {
  return async (t, machine, controller) => {
    const result = await controller.run('status');
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
  };
}

/**
 * The devbox's command for this decision, through its controller: a start (its window then counts as auto-started),
 * a stop, or a due reading. Without a connected controller a start waits for the next step; a stop is logged `failed`
 * (the window's end comes once).
 */
async function devboxWork(
  deps: Deps,
  t: TenantDb,
  machine: Machine,
  state: PowerState,
  decision: PowerDecision,
  now: Date,
): Promise<{ work: (() => Promise<void>) | undefined; patch: Partial<PowerState> }> {
  if (decision.start === null && decision.stop === null && !boxCheckDue(state.box, now)) {
    return { work: undefined, patch: {} };
  }
  const controller = await deps.control.resolve(t, machine);
  if (!controller.ok) {
    if (decision.stop !== null) {
      const reason = `${decision.stop}, but the box could not be stopped: ${controller.message}`;
      await logPower(t, machine.id, { action: 'failed', reason, actor: 'schedule', at: now });
    }
    return { work: undefined, patch: {} };
  }
  const run = (work: Work) => () => work(t, machine, controller);
  if (decision.start !== null) {
    return {
      work: run(powerWork(deps, 'start', decision.start.reason)),
      patch: { autoStartedWindow: decision.start.window },
    };
  }
  if (decision.stop !== null) return { work: run(powerWork(deps, 'stop', decision.stop)), patch: {} };
  return { work: run(checkWork(deps)), patch: {} };
}

/** The commands in flight, one per machine at most. */
interface Commands {
  busy(machineId: string): boolean;
  begin(machineId: string, work: () => Promise<void>): void;
}

/** One machine's decision; while a command of it runs, only its hold is decided. Returns what changed. */
async function stepOne(
  deps: Deps,
  commands: Commands,
  t: TenantDb,
  machine: Machine,
  now: Date,
): Promise<{ held: boolean; began: boolean }> {
  const { policy, state } = await readPower(t, machine.id);
  const powered = isPowered(machine);
  const boxStatus = powered ? (state.box?.status ?? null) : null;
  const facts = { kind: machine.kind, provider: machine.provider, liveWork: false, boxStatus };
  const decision = decide(policy, state, now, facts);
  const holdPatch = await applyHold(deps, t, machine.id, state, decision.hold, now);
  const held = Object.keys(holdPatch).length > 0;
  if (commands.busy(machine.id)) {
    await saveState(t, machine.id, holdPatch);
    return { held, began: false };
  }
  const patch: Partial<PowerState> = {
    ...holdPatch,
    ...(decision.window === state.window ? {} : { window: decision.window }),
    ...(decision.autoStartedWindow === state.autoStartedWindow
      ? {}
      : { autoStartedWindow: decision.autoStartedWindow }),
  };
  if (decision.kept !== null) {
    await logPower(t, machine.id, { action: 'kept', reason: decision.kept, actor: 'schedule', at: now });
  }
  const devbox = powered
    ? await devboxWork(deps, t, machine, state, decision, now)
    : { work: undefined, patch: {} };
  await saveState(t, machine.id, { ...patch, ...devbox.patch });
  if (devbox.work !== undefined) commands.begin(machine.id, devbox.work);
  return { held, began: devbox.work !== undefined };
}

export function powerScheduler(schedulerDeps: SchedulerDeps): PowerScheduler {
  const deps: Deps = { ...schedulerDeps, control: controlOf(schedulerDeps) };
  const running = new Map<string, Promise<void>>();
  const commands: Commands = {
    busy: (machineId) => running.has(machineId),
    begin(machineId, work) {
      const done = work()
        .catch((error: unknown) =>
          deps.logger.error({ err: error, machineId }, 'power: a scheduled command failed'),
        )
        .finally(() => running.delete(machineId));
      running.set(machineId, done);
    },
  };
  return {
    async step(now) {
      const tenants = new Map<string, TenantDb>();
      const tenantOf = async (companyId: string) => {
        const t = tenants.get(companyId) ?? (await tenant(deps.db, companyId));
        tenants.set(companyId, t);
        return t;
      };
      let [machines, holds, began] = [0, 0, 0];
      for (const machine of await presentMachines(deps.db)) {
        try {
          const t = await tenantOf(machine.companyId);
          const done = await stepOne(deps, commands, t, machine, now);
          machines++;
          if (done.held) holds++;
          if (done.began) began++;
          // The safety net: the tunnels in step with the rows (a runner's set is sent only when it changed).
          await deps.control.syncTunnels(t, machine.id);
        } catch (error) {
          deps.logger.error({ err: error, machineId: machine.id }, 'power: could not decide for a machine');
        }
      }
      return { machines, holds, commands: began };
    },
    async idle() {
      while (running.size > 0) await Promise.all(running.values());
    },
  };
}
