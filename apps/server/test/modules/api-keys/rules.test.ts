import { describe, expect, it } from 'vitest';
import {
  expiryAt,
  keyStatusAt,
  listAllRefusal,
  mintRefusal,
  revokeRefusal,
  wantsAll,
} from '../../../src/modules/api-keys/rules.ts';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const DAY = 86_400_000;

describe('expiryAt', () => {
  it('is 90 days later by default, or the days asked for', () => {
    expect(expiryAt(NOW)).toEqual(new Date(NOW.getTime() + 90 * DAY));
    expect(expiryAt(NOW, 1)).toEqual(new Date(NOW.getTime() + DAY));
    expect(expiryAt(NOW, 365)).toEqual(new Date(NOW.getTime() + 365 * DAY));
  });
});

describe('keyStatusAt', () => {
  const later = new Date(NOW.getTime() + 1);
  it.each([
    [{ revokedAt: null, expiresAt: null }, 'active'],
    [{ revokedAt: null, expiresAt: later }, 'active'],
    [{ revokedAt: null, expiresAt: NOW }, 'expired'],
    [{ revokedAt: NOW, expiresAt: later }, 'revoked'],
    [{ revokedAt: NOW, expiresAt: NOW }, 'revoked'],
  ] as const)('%o is %s', (key, status) => {
    expect(keyStatusAt(key, NOW)).toBe(status);
  });
});

describe('who may do what', () => {
  it('lets only a session make keys', () => {
    expect(mintRefusal('clerk')).toBeUndefined();
    for (const via of ['api_key', 'run_token']) {
      expect(mintRefusal(via)).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    }
  });

  it('reads ?all as on for 1 and true only', () => {
    expect([undefined, '0', 'false', '1', 'true'].map(wantsAll)).toEqual([false, false, false, true, true]);
  });

  it('lets admins and owners list every key', () => {
    expect(listAllRefusal('owner')).toBeUndefined();
    expect(listAllRefusal('admin')).toBeUndefined();
    expect(listAllRefusal('member')).toMatchObject({ status: 403, code: 'forbidden' });
    expect(listAllRefusal('viewer')).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it("lets anyone revoke their own key, and admins and owners anyone's", () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(revokeRefusal(role, true)).toBeUndefined();
    }
    expect(revokeRefusal('owner', false)).toBeUndefined();
    expect(revokeRefusal('admin', false)).toBeUndefined();
    expect(revokeRefusal('member', false)).toMatchObject({ status: 403, code: 'forbidden' });
    expect(revokeRefusal('viewer', false)).toMatchObject({ status: 403, code: 'forbidden' });
  });
});
