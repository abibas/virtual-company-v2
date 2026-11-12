import type { DbHandle, Machine, TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import type { Logger } from 'pino';
import { machinesRepo } from '../../repo.ts';
import { alreadyText } from '../../rules/power/text.ts';
import {
  boxComingUp,
  mayStart,
  noControllerText,
  noPowerText,
  notStartedText,
  startByHandText,
  switchOn,
  type WakeMachine,
  type WakeTrigger,
} from '../../rules/power/wake.ts';
import { isPowered, type PowerActor } from '../../rules/power.ts';
import { MACHINE_NOT_FOUND, type Refusal } from '../../rules.ts';
import type { RunnerHub } from '../runner/hub.ts';
import type { ContainerPower } from './container.ts';
import type { Controller, PowerControl } from './control.ts';
import { refreshHold } from './hold.ts';
import { logPower, readPower, saveFailure, saveReading, saveState } from './store.ts';

/**
 * Waking a machine for work (docs/machines.md, "Waking a machine for work"): other modules ask when a message, a task's
 * step or a Lead's wake-up needs an agent whose machine's runner is not connected. A machine with power control (a
 * devbox through its controller, a container runner's container with this server's Docker) is started when its
 * policy's switch for the trigger is on (`autoStartOnMessage`, `autoStartOnWork`) or a person who may power it (an
 * admin or owner) asked, through the same path as a Start by hand, in the background: it is logged `started` or
 * `failed` with the wake's reason, as `auto` or as that person, and a failed one is told to `onFailed`'s listeners.
 * A start under way (in this process, or a box read `starting` or `running` lately) is not sent again. Each wake moves
 * the machine's hold after a turn to now, so the box stays up for the work once its runner connects (its hold is sent
 * on connect).
 */

export type { WakeMachine, WakeTrigger } from '../../rules/power/wake.ts';

export interface WakeDeps {
  readonly db: DbHandle;
  readonly hub: RunnerHub;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly control: PowerControl;
  readonly containers: ContainerPower;
}

/** What wants the machine, why (the power log's words), for whom, and whether that person asked to start it. */
export interface WakeRequest {
  readonly trigger: WakeTrigger;
  /** "Started for a message to Developer", "Started for T-3 · Code review". */
  readonly reason: string;
  /** The person the work is for (who sent the message, whose move started the step), with their role here. */
  readonly person?: { readonly userId: string; readonly role: MembershipRole } | undefined;
  /** The person asked to start the machine (Start and send): started whatever the switch says, if they may. */
  readonly asked?: boolean | undefined;
}

/**
 * What a wake did: the runner is connected (`up`), a start was sent or is under way (`starting`), the switch for the
 * trigger is off and nobody asked (`switch_off`, with whether the person may start it), or nothing here can start it
 * now (`cannot`, why in words).
 */
export type Woken =
  | { readonly ok: true; readonly state: 'up' | 'starting'; readonly machine: WakeMachine }
  | {
      readonly ok: false;
      readonly state: 'switch_off';
      readonly machine: WakeMachine;
      readonly canStart: boolean;
    }
  | { readonly ok: false; readonly state: 'cannot'; readonly machine: WakeMachine; readonly message: string };

/** A start that failed, for the listeners: the machine and why, in words. */
export interface WakeFailure {
  readonly companyId: string;
  readonly machineId: string;
  readonly message: string;
}

const repo = machinesRepo();

const machineOf = (row: Machine): WakeMachine => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  provider: row.provider,
  hourlyCost: row.hourlyCost,
});

type Begin = (machine: Machine, run: () => Promise<string | undefined>) => void;

/** The devbox's start through its controller: its reading and tunnels kept, the start or the failure logged. */
async function startBox(deps: WakeDeps, t: TenantDb, machine: Machine, controller: Controller, log: Logged) {
  const result = await controller.run('start');
  const { state } = await readPower(t, machine.id);
  const at = deps.clock();
  if (result.ok) {
    await saveReading(t, machine, state.box, result.reading, at);
    await deps.control.syncTunnels(t, controller.machineId);
    await log.started(at, result.already);
    return undefined;
  }
  if (result.status === 502) {
    await saveFailure(t, machine.id, state.box, { code: result.driverCode, message: result.detail }, at);
  }
  return log.failed(at, result.status === 502 ? result.detail : result.message);
}

/** The container's start with this server's Docker, logged as the box's is. */
async function startContainer(deps: WakeDeps, machine: Machine, log: Logged) {
  const result = await deps.containers.act(machine, 'start', false);
  const at = deps.clock();
  if (result.ok) {
    await log.started(at, result.already);
    return undefined;
  }
  return log.failed(at, result.status === 502 ? result.detail : result.message);
}

/** How a wake's start is logged: `started` (or found already on) and `failed`, which gives the listeners' words. */
interface Logged {
  started(at: Date, already: boolean): Promise<void>;
  failed(at: Date, why: string): Promise<string>;
}

function logged(t: TenantDb, machine: Machine, reason: string, actor: PowerActor): Logged {
  const thing = machine.kind === 'container' ? 'container' : 'box';
  return {
    async started(at, already) {
      const said = already ? alreadyText(reason, 'start', thing) : reason;
      await logPower(t, machine.id, { action: 'started', reason: said, actor, at });
    },
    async failed(at, why) {
      await logPower(t, machine.id, {
        action: 'failed',
        reason: `${reason}, but the start failed: ${why}`,
        actor,
        at,
      });
      return notStartedText(machine.name, why);
    },
  };
}

/** The hold after a turn, from now: the box stays up for the work (sent to its runner when it connects). */
async function holdForWork(deps: WakeDeps, t: TenantDb, machine: Machine) {
  const now = deps.clock();
  await saveState(t, machine.id, { lastTurnAt: now.toISOString() });
  await refreshHold(deps, t, machine, now);
}

/** Starts the machine if it may and can (see above); the start itself runs in the background through `begin`. */
async function wakeOne(
  deps: WakeDeps,
  begin: Begin & { readonly busy: (machineId: string) => boolean },
  t: TenantDb,
  row: Machine,
  request: WakeRequest,
): Promise<Woken> {
  const machine = machineOf(row);
  if (deps.hub.isOnline(row.id)) return { ok: true, state: 'up', machine };
  const container = row.kind === 'container';
  if (!isPowered(row) && !container)
    return { ok: false, state: 'cannot', machine, message: noPowerText(row) };
  const { policy, state } = await readPower(t, row.id);
  if (begin.busy(row.id) || (!container && boxComingUp(state.box, deps.clock()))) {
    await holdForWork(deps, t, row);
    return { ok: true, state: 'starting', machine };
  }
  const canStart = request.person !== undefined && roleAtLeast(request.person.role, 'admin');
  if (!mayStart(switchOn(policy, request.trigger), request.asked === true, canStart)) {
    return { ok: false, state: 'switch_off', machine, canStart };
  }
  const actor: PowerActor =
    request.asked === true && request.person ? `user:${request.person.userId}` : 'auto';
  const log = logged(t, row, request.reason, actor);
  if (container) {
    if (!deps.containers.docker)
      return { ok: false, state: 'cannot', machine, message: startByHandText(row.name) };
    begin(row, () => startContainer(deps, row, log));
  } else {
    const controller = await deps.control.resolve(t, row);
    if (!controller.ok) {
      return { ok: false, state: 'cannot', machine, message: noControllerText(row.name, controller.message) };
    }
    begin(row, () => startBox(deps, t, row, controller, log));
  }
  await holdForWork(deps, t, row);
  return { ok: true, state: 'starting', machine };
}

/** The wakes of this process: one start at a time per machine, the failed ones told to the listeners. */
export function machineWake(deps: WakeDeps) {
  const running = new Map<string, Promise<void>>();
  const listeners = new Set<(failure: WakeFailure) => void>();
  const tell = (failure: WakeFailure) => {
    for (const listener of listeners) {
      try {
        listener(failure);
      } catch (error) {
        deps.logger.error({ err: error, machineId: failure.machineId }, 'power: a wake listener failed');
      }
    }
  };
  const begin: Begin & { readonly busy: (machineId: string) => boolean } = Object.assign(
    (machine: Machine, run: () => Promise<string | undefined>) => {
      const done = run()
        .then((failed) => {
          if (failed !== undefined)
            tell({ companyId: machine.companyId, machineId: machine.id, message: failed });
        })
        .catch((error: unknown) => {
          deps.logger.error(
            { err: error, machineId: machine.id },
            'power: a wake could not start its machine',
          );
          tell({
            companyId: machine.companyId,
            machineId: machine.id,
            message: notStartedText(machine.name, 'the server failed'),
          });
        })
        .finally(() => running.delete(machine.id));
      running.set(machine.id, done);
    },
    { busy: (machineId: string) => running.has(machineId) },
  );
  return {
    /** Wakes the machine for the request (see above); 404 for a machine not in the company. */
    async wake(t: TenantDb, machineId: string, request: WakeRequest): Promise<Woken | Refusal<404>> {
      const row = await repo.get(t, machineId);
      if (row === undefined) return MACHINE_NOT_FOUND;
      return wakeOne(deps, begin, t, row, request);
    },
    /** Hears of every start that failed; returns how to stop hearing. */
    onFailed(listener: (failure: WakeFailure) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Resolves once every start begun so far is done. */
    async idle(): Promise<void> {
      while (running.size > 0) await Promise.all(running.values());
    },
  };
}

export type MachineWake = ReturnType<typeof machineWake>;
