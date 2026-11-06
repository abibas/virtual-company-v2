import type { Machine, TenantDb } from '@mwc/db';
import type { MachinePowerErrorCode } from '@mwc/machines-core';
import type { PowerEventAction } from '@mwc/shared/enums';
import {
  DEFAULT_MACHINE_POWER_POLICY,
  DevboxSize,
  MachinePowerPolicy,
  PowerStatus,
} from '@mwc/shared/machines';
import { z } from 'zod';
import { powerRepo } from '../../repo/power.ts';
import { machinesRepo } from '../../repo.ts';
import type { BoxState, PowerActor, PowerState } from '../../rules/power.ts';
import { BoxRulesSchema, PowerErrorCode } from '../../schemas/power.ts';

/**
 * A machine's power row as the power code uses it: the policy (the default when there is no row, or a stored one that
 * no longer parses) and the scheduler's state, each field read on its own so one bad field never hides the rest; state
 * changes merged into the row; events with their reason cut to the column's 500 characters.
 */

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().catch(null);
const text = nullable(z.string());

export const StoredBox = z.object({
  status: PowerStatus.catch('unknown'),
  size: nullable(DevboxSize),
  hourlyCost: nullable(z.number().nonnegative()),
  rules: nullable(BoxRulesSchema),
  checkedAt: text,
  error: nullable(z.object({ code: PowerErrorCode, message: z.string() })),
});

const StoredState = z.object({
  holdUntil: text,
  holdReason: text,
  holdKind: nullable(z.enum(['keep_on', 'after_turn'])),
  autoStartedWindow: text,
  manualStopAt: text,
  lastTurnAt: text,
  window: text,
  box: nullable(StoredBox),
});

export interface PowerRecord {
  readonly policy: MachinePowerPolicy;
  readonly state: PowerState;
}

/** The scheduler's state from its jsonb. */
export function stateOf(raw: unknown): PowerState {
  return StoredState.parse(typeof raw === 'object' && raw !== null ? raw : {});
}

/** A policy from its jsonb: the default when it does not parse. */
export function policyOf(raw: unknown): MachinePowerPolicy {
  const parsed = MachinePowerPolicy.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_MACHINE_POWER_POLICY;
}

/** The machine's policy and state; the defaults when it has no row yet. */
export async function readPower(t: TenantDb, machineId: string): Promise<PowerRecord> {
  const row = await powerRepo.get(t, machineId);
  return { policy: policyOf(row?.policy), state: stateOf(row?.state) };
}

/** Merges state fields into the machine's row (made on the first write); nothing for an empty patch. */
export async function saveState(t: TenantDb, machineId: string, patch: Partial<PowerState>): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await powerRepo.mergeState(t, machineId, patch);
}

/** What the controller read of the box after a command. */
export type BoxReading = Pick<BoxState, 'status' | 'size' | 'hourlyCost' | 'rules'>;

const NO_BOX: BoxState = {
  status: 'unknown',
  size: null,
  hourlyCost: null,
  rules: null,
  checkedAt: null,
  error: null,
};

/** A box's state with a change merged into the one before (the defaults before the first reading). */
export function nextBox(before: BoxState | null, change: Partial<BoxState> = {}): BoxState {
  return { ...(before ?? NO_BOX), ...change };
}

/** Saves a reading of the box: checked now, no error; and the machine's hourly cost when the reading knows it. */
export async function saveReading(
  t: TenantDb,
  machine: Machine,
  before: BoxState | null,
  reading: BoxReading,
  now: Date,
): Promise<void> {
  await saveState(t, machine.id, {
    box: nextBox(before, { ...reading, checkedAt: now.toISOString(), error: null }),
  });
  if (reading.hourlyCost !== null && reading.hourlyCost !== machine.hourlyCost) {
    await machinesRepo().update(t, machine.id, { hourlyCost: reading.hourlyCost });
  }
}

/** Saves a failed reading or command: why, checked now; the last reading stays. */
export async function saveFailure(
  t: TenantDb,
  machineId: string,
  before: BoxState | null,
  error: { code: MachinePowerErrorCode; message: string },
  now: Date,
): Promise<void> {
  await saveState(t, machineId, { box: nextBox(before, { checkedAt: now.toISOString(), error }) });
}

/** Writes one power event. */
export async function logPower(
  t: TenantDb,
  machineId: string,
  event: { action: PowerEventAction; reason: string; actor: PowerActor; at: Date },
): Promise<void> {
  const reason = event.reason.length > 500 ? `${event.reason.slice(0, 499)}…` : event.reason;
  await powerRepo.log(t, { machineId, ...event, reason });
}
