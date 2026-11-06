import { DEFAULT_BOX_RULES } from '@mwc/machines-core';
import { describe, expect, it } from 'vitest';
import { GCE_STATUSES, parseInstance, parseInstances, readingOf, refOf } from '../src/instance.ts';
import { BOX, describeJson, gceInstance, listJson, ZONE } from './fixtures/gce.ts';

describe('parseInstance', () => {
  it('reads describe’s JSON and refuses what is not an instance', () => {
    expect(parseInstance(describeJson())).toMatchObject({ name: BOX, status: 'RUNNING' });
    expect(() => parseInstance('Listed 0 items.')).toThrow(expect.objectContaining({ code: 'failed' }));
    expect(() => parseInstance('{"name":"x"}')).toThrow(/unexpected shape/);
    expect(parseInstances(listJson({}, { name: 'dev-two' }))).toHaveLength(2);
    expect(parseInstances('[]')).toEqual([]);
  });
});

describe('readingOf', () => {
  it('maps GCE’s statuses', () => {
    const mapped = Object.fromEntries(
      [...Object.keys(GCE_STATUSES), 'REPAIRING'].map((status) => [
        status,
        readingOf(parseInstance(describeJson({ status }))).status,
      ]),
    );
    expect(mapped).toEqual({
      RUNNING: 'running',
      TERMINATED: 'stopped',
      STOPPED: 'stopped',
      SUSPENDED: 'stopped',
      PROVISIONING: 'starting',
      STAGING: 'starting',
      STOPPING: 'stopping',
      SUSPENDING: 'stopping',
      REPAIRING: 'unknown',
    });
  });

  it('reads the size and cost from the machine type, else the size label, and the box’s rules', () => {
    expect(readingOf(parseInstance(describeJson()))).toEqual({
      status: 'running',
      size: 'm',
      hourlyCost: 0.268,
      rules: DEFAULT_BOX_RULES,
    });
    const labelled = readingOf(
      parseInstance(describeJson({ machineType: 'custom-6-12288', labels: { size: 'l' } })),
    );
    expect(labelled).toMatchObject({ size: 'l', hourlyCost: 0.536 });
    const unknown = readingOf(parseInstance(describeJson({ machineType: 'n2-standard-8', labels: {} })));
    expect(unknown).toEqual({ status: 'running', rules: DEFAULT_BOX_RULES });
    const bare = { ...gceInstance({ items: [{ key: 'devbox-tz', value: 'Europe/Kyiv' }] }) };
    delete bare.machineType;
    delete bare.labels;
    expect(readingOf(parseInstance(JSON.stringify(bare)))).toEqual({
      status: 'running',
      rules: { ...DEFAULT_BOX_RULES, timezone: 'Europe/Kyiv' },
    });
    const noMetadata = { ...gceInstance(), metadata: { fingerprint: 'x' } };
    expect(readingOf(parseInstance(JSON.stringify(noMetadata))).rules).toEqual(DEFAULT_BOX_RULES);
  });
});

describe('refOf', () => {
  it('is the instance, its zone and size, or null for names the app does not take', () => {
    expect(refOf(parseInstance(describeJson()))).toEqual({ instance: BOX, zone: ZONE, size: 'm' });
    expect(refOf(parseInstance(describeJson({ machineType: 'n2-standard-8', labels: {} })))).toEqual({
      instance: BOX,
      zone: ZONE,
    });
    expect(refOf(parseInstance(describeJson({ name: 'Dev_Upper' })))).toBeNull();
  });
});
