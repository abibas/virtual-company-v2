import type { PowerStatus } from '@mwc/shared/machines';
import type { TunnelSpec } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { isTunnelWanted, tunnelSetKey } from '../../../../src/modules/machines/rules/tunnels.ts';

const tunnel = (machineId: string, port = 9950, size?: 'm' | 'l'): TunnelSpec => ({
  machineId,
  target: {
    provider: 'airia_devbox',
    ref: { instance: 'dev-ihor', zone: 'europe-west1-b', ...(size ? { size } : {}) },
  },
  remotePort: port,
  localPort: port,
});

describe('isTunnelWanted', () => {
  it('links a box that is up, coming up or not known yet, never one stopped, stopping or missing', () => {
    const wanted = (status: PowerStatus | null) => isTunnelWanted(status);
    expect([null, 'running', 'starting', 'unknown'].map((s) => wanted(s as PowerStatus | null))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect((['stopped', 'stopping', 'missing'] as const).map(wanted)).toEqual([false, false, false]);
  });
});

describe('tunnelSetKey', () => {
  it('is the same for the same tunnels in any order or size, and differs for another port or machine', () => {
    const [a, b] = ['019a0000-0000-7000-8000-00000000000a', '019a0000-0000-7000-8000-00000000000b'];
    expect(tunnelSetKey([tunnel(a), tunnel(b)])).toBe(tunnelSetKey([tunnel(b), tunnel(a, 9950, 'l')]));
    expect(tunnelSetKey([tunnel(a)])).not.toBe(tunnelSetKey([tunnel(a, 9960)]));
    expect(tunnelSetKey([tunnel(a)])).not.toBe(tunnelSetKey([tunnel(b)]));
    expect(tunnelSetKey([])).toBe('[]');
  });

  it('differs once a box reads running, and treats a left-out running as false', () => {
    const a = '019a0000-0000-7000-8000-00000000000a';
    expect(tunnelSetKey([{ ...tunnel(a), running: true }])).not.toBe(tunnelSetKey([tunnel(a)]));
    expect(tunnelSetKey([{ ...tunnel(a), running: false }])).toBe(tunnelSetKey([tunnel(a)]));
  });
});
