import {
  boxRulesFromMetadata,
  MachinePowerError,
  type PowerReading,
  type PowerRef,
} from '@mwc/machines-core';
import { AiriaDevboxRef, DevboxSize, type PowerStatus } from '@mwc/shared/machines';
import { z } from 'zod';
import { DEVBOX_SIZES, lastSegment, sizeOfMachineType } from './catalog.ts';

/** The parts of a GCE instance (`gcloud compute instances describe|list --format=json`) the driver reads. */
export const GceInstance = z.object({
  name: z.string(),
  /** A URL ending in the zone. */
  zone: z.string(),
  status: z.string(),
  /** A URL ending in the machine type. */
  machineType: z.string().optional(),
  metadata: z
    .object({ items: z.array(z.object({ key: z.string(), value: z.string().optional() })).optional() })
    .optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type GceInstance = z.infer<typeof GceInstance>;

/** GCE's instance statuses in the app's words; any other (REPAIRING, a new one) reads as `unknown`. */
export const GCE_STATUSES: Readonly<Record<string, PowerStatus>> = {
  RUNNING: 'running',
  TERMINATED: 'stopped',
  STOPPED: 'stopped',
  SUSPENDED: 'stopped',
  PROVISIONING: 'starting',
  STAGING: 'starting',
  STOPPING: 'stopping',
  SUSPENDING: 'stopping',
};

function parseJson<T>(schema: z.ZodType<T>, stdout: string, what: string): T {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (cause) {
    throw new MachinePowerError('failed', `gcloud's answer to ${what} is not JSON.`, { cause });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new MachinePowerError('failed', `gcloud's answer to ${what} has an unexpected shape.`);
  return parsed.data;
}

/** One instance from `describe --format=json`; a `failed` error when the output does not parse. */
export function parseInstance(stdout: string): GceInstance {
  return parseJson(GceInstance, stdout, 'describe');
}

/** The instances from `list --format=json`. */
export function parseInstances(stdout: string): GceInstance[] {
  return parseJson(z.array(GceInstance), stdout, 'list');
}

/** The box's size: from its machine type, else from its `size` label. */
function sizeOf(instance: GceInstance): DevboxSize | undefined {
  const fromType = instance.machineType === undefined ? undefined : sizeOfMachineType(instance.machineType);
  if (fromType !== undefined) return fromType;
  const label = DevboxSize.safeParse(instance.labels?.size);
  return label.success ? label.data : undefined;
}

/** What the port reports about an instance: its status, size, hourly cost and its own stop rules. */
export function readingOf(instance: GceInstance): PowerReading {
  const size = sizeOf(instance);
  return {
    status: GCE_STATUSES[instance.status] ?? 'unknown',
    ...(size === undefined ? {} : { size, hourlyCost: DEVBOX_SIZES[size].hourlyCost }),
    rules: boxRulesFromMetadata(instance.metadata?.items),
  };
}

/** Where an instance is, as `machines.provider_ref`; null when its name or zone is not one the app accepts. */
export function refOf(instance: GceInstance): PowerRef | null {
  const size = sizeOf(instance);
  const ref = AiriaDevboxRef.safeParse({
    instance: instance.name,
    zone: lastSegment(instance.zone),
    ...(size === undefined ? {} : { size }),
  });
  return ref.success ? ref.data : null;
}
