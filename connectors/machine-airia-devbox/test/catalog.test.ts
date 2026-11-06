import { describe, expect, it } from 'vitest';
import { DEVBOX_SIZES, lastSegment, sizeOfMachineType } from '../src/catalog.ts';

describe('the size catalogue', () => {
  it('has the airia CLI’s machine types and hourly figures', () => {
    expect(DEVBOX_SIZES).toEqual({
      s: { machineType: 'e2-standard-4', hourlyCost: 0.134 },
      m: { machineType: 'e2-standard-8', hourlyCost: 0.268 },
      l: { machineType: 'e2-standard-16', hourlyCost: 0.536 },
      xl: { machineType: 'e2-standard-32', hourlyCost: 1.073 },
    });
  });

  it('finds a size by machine type name or URL', () => {
    expect(sizeOfMachineType('e2-standard-4')).toBe('s');
    expect(
      sizeOfMachineType(
        'https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/machineTypes/e2-standard-32',
      ),
    ).toBe('xl');
    expect(sizeOfMachineType('n2-standard-8')).toBeUndefined();
  });

  it('takes the last part of a resource URL', () => {
    expect(lastSegment('https://x/zones/europe-west1-b')).toBe('europe-west1-b');
    expect(lastSegment('us-central1-a')).toBe('us-central1-a');
  });
});
