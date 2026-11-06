import { type DbHandle, type Machine, type TenantDb, tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import type { Logger } from 'pino';
import { machinesRepo } from '../../repo.ts';
import { type Hold, holdEvent, holdOf, type PowerState } from '../../rules/power.ts';
import type { ConnectedRunner, RunnerHub } from '../hub.ts';
import { logPower, readPower, saveState } from './store.ts';

/**
 * A machine's hold (docs/runner-protocol.md, "Hold and power"): the server decides it from the policy and sends it to
 * the machine's runner as `machine.hold {until}` when it changes, whenever the runner connects, and after a policy
 * change; the change is logged `held` or `released` and kept in the state.
 */

export interface HoldDeps {
  readonly hub: RunnerHub;
  readonly logger: Logger;
}

/** Sends the hold to the machine's runner when it is connected; its answer is awaited in the background. */
export function sendHold(deps: HoldDeps, machineId: string, until: number | null): boolean {
  if (!deps.hub.isOnline(machineId)) return false;
  deps.hub.request(machineId, { type: 'machine.hold', cmdId: newId(), until }).then(
    (ack) => {
      if (!ack.ok) deps.logger.warn({ machineId, error: ack.error }, 'power: the runner refused its hold');
    },
    (error: unknown) =>
      deps.logger.warn({ machineId, err: error }, 'power: the runner did not take its hold'),
  );
  return true;
}

/**
 * Applies a decided hold: logs `held` / `released` when it starts, ends or changes what it is for, sends it when its
 * end changed (or `always`), and returns the state fields to save (none when nothing changed).
 */
export async function applyHold(
  deps: HoldDeps,
  t: TenantDb,
  machineId: string,
  state: PowerState,
  hold: Hold | null,
  now: Date,
  options: { readonly always?: boolean } = {},
): Promise<Partial<PowerState>> {
  const holdUntil = hold === null ? null : hold.until.toISOString();
  const changed = holdUntil !== state.holdUntil || (hold?.kind ?? null) !== state.holdKind;
  const event = holdEvent(state, hold);
  if (event !== null) await logPower(t, machineId, { ...event, at: now });
  if (changed || options.always) sendHold(deps, machineId, hold === null ? null : hold.until.getTime());
  if (!changed) return {};
  return { holdUntil, holdReason: hold?.reason ?? null, holdKind: hold?.kind ?? null };
}

/** Decides the machine's hold now and sends it (`always`: even when it did not change), saving what changed. */
export async function refreshHold(
  deps: HoldDeps,
  t: TenantDb,
  machine: Machine,
  now: Date,
  options: { readonly always?: boolean } = {},
): Promise<void> {
  const { policy, state } = await readPower(t, machine.id);
  const patch = await applyHold(
    deps,
    t,
    machine.id,
    state,
    holdOf(policy, state, now, machine),
    now,
    options,
  );
  await saveState(t, machine.id, patch);
}

/** The hub's connect listener: a runner that connects gets its machine's hold at once. */
export function holdOnConnect(
  deps: HoldDeps & { readonly db: DbHandle; readonly clock: () => Date },
): (runner: ConnectedRunner) => void {
  return (runner) => {
    const send = async () => {
      const t = await tenant(deps.db, runner.companyId);
      const machine = await machinesRepo().get(t, runner.machineId);
      if (machine !== undefined) await refreshHold(deps, t, machine, deps.clock(), { always: true });
    };
    send().catch((error: unknown) => {
      deps.logger.error(
        { err: error, machineId: runner.machineId },
        'power: could not send a connected runner its hold',
      );
    });
  };
}
