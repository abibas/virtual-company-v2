import { tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiKeysService } from '../../../src/modules/api-keys/service.ts';
import { keyRows } from '../../fixtures/api-keys.ts';
import { addMember, membersCompany } from '../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('apiKeysService().create', () => {
  // The route's guard has already let the caller in; a removal that commits before the key's transaction takes the
  // company's lock leaves the membership removed when it is read again there.
  it('refuses a member removed after the guard let them in, and stores nothing', async () => {
    const company = await membersCompany(w);
    const gone = await addMember(w, company, 'admin', 'removed');
    const result = await apiKeysService({ db: w.t.db }).create(await tenant(w.t.db, company.companyId), {
      membershipId: gone.membershipId,
      principalId: gone.principalId,
      role: 'admin',
      requestId: 'req',
      now: new Date(TEST_NOW),
      via: 'clerk',
      name: 'late',
      expiresInDays: 90,
    });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'forbidden' });
    expect(await keyRows(w.t.db, company.companyId)).toEqual([]);
  });
});
