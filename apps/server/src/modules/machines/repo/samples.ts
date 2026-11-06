import { type MachineSampleRow, machineSamples, type TenantDb } from '@mwc/db';
import type { MachineSample } from '@mwc/shared/machines';
import { gt } from 'drizzle-orm';

/** Machine samples (`machine_samples`), through the company's tenant: one row per machine and minute. */

/** Keeps the sample under its minute; a second sample of the same minute replaces the first. */
async function upsert(t: TenantDb, machineId: string, at: Date, sample: MachineSample): Promise<void> {
  const { at: _taken, ...values } = sample;
  await t.insert(machineSamples, { machineId, at, ...values }).onConflictDoUpdate({
    target: [machineSamples.companyId, machineSamples.machineId, machineSamples.at],
    set: values,
  });
}

/** Every sample of the company's machines after `at`. */
const since = (t: TenantDb, at: Date): Promise<MachineSampleRow[]> =>
  t.select(machineSamples, gt(machineSamples.at, at));

export const samplesRepo = { upsert, since };
