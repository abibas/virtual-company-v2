import { companies, enrollmentTokens, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { ENROLLMENT_TOKEN_PATTERN } from '@mwc/shared/runner-protocol';
import { seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from '../../../src/platform/auth/api-keys.ts';
import { findEnrollmentToken, generateEnrollmentToken } from '../../../src/platform/auth/enrollment.ts';
import { type AuthWorld, authWorld } from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

describe('generateEnrollmentToken', () => {
  it('makes mwc_et_ and 32 base62 characters, new every time, with its SHA-256', () => {
    const first = generateEnrollmentToken();
    expect(first.token).toMatch(ENROLLMENT_TOKEN_PATTERN);
    expect(first.secretHash).toBe(hashApiKey(first.token));
    expect(generateEnrollmentToken().token).not.toBe(first.token);
  });
});

describe('findEnrollmentToken', () => {
  it("finds a token's row and company by its SHA-256, across companies; nothing for an unknown or malformed one", async () => {
    const seeded = await seedCompany(w.t.db);
    const generated = generateEnrollmentToken();
    const t = await tenant(w.t.db, seeded.company.id);
    const [row] = await t
      .insert(enrollmentTokens, {
        secretHash: generated.secretHash,
        expiresAt: w.clock(),
        createdBy: seeded.owner.principal.id,
      })
      .returning();
    expect(await findEnrollmentToken(w.t.db, generated.token)).toEqual({
      id: row?.id,
      companyId: seeded.company.id,
    });
    expect(await findEnrollmentToken(w.t.db, generateEnrollmentToken().token)).toBeUndefined();
    expect(await findEnrollmentToken(w.t.db, 'mwc_et_short')).toBeUndefined();
    // A deleted company's tokens are unknown, by its status or its deletion time.
    const where = eq(companies.id, seeded.company.id);
    await rawDb(w.t.db).update(companies).set({ status: 'deleted' }).where(where);
    expect(await findEnrollmentToken(w.t.db, generated.token)).toBeUndefined();
    await rawDb(w.t.db).update(companies).set({ status: 'active', deletedAt: w.clock() }).where(where);
    expect(await findEnrollmentToken(w.t.db, generated.token)).toBeUndefined();
  });
});
