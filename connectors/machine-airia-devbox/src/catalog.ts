import type { DevboxSize } from '@mwc/shared/machines';

/** One devbox size: its GCE machine type and the airia CLI's hourly figure (us-central1 list price, rounded). */
export interface DevboxSizeSpec {
  readonly machineType: string;
  /** US dollars an hour. */
  readonly hourlyCost: number;
}

/** The airia CLI's size catalogue (`size_machine`, `machine_hourly`). */
export const DEVBOX_SIZES: Readonly<Record<DevboxSize, DevboxSizeSpec>> = {
  s: { machineType: 'e2-standard-4', hourlyCost: 0.134 },
  m: { machineType: 'e2-standard-8', hourlyCost: 0.268 },
  l: { machineType: 'e2-standard-16', hourlyCost: 0.536 },
  xl: { machineType: 'e2-standard-32', hourlyCost: 1.073 },
};

/** The last part of a GCE resource URL (`…/zones/us-central1-a` → `us-central1-a`), or the name itself. */
export function lastSegment(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

/** The size of a machine type, by its name or its URL; undefined for a type outside the catalogue. */
export function sizeOfMachineType(machineType: string): DevboxSize | undefined {
  const name = lastSegment(machineType);
  const entry = Object.entries(DEVBOX_SIZES).find(([, spec]) => spec.machineType === name);
  return entry?.[0] as DevboxSize | undefined;
}
