import { apiKeys, companies, enrollmentTokens } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { API_KEY_PATTERN } from '@mwc/shared/api-keys';
import {
  ENROLLMENT_TOKEN_PATTERN,
  ENROLLMENT_TOKEN_TTL_MS,
  type RunnerEnrollResponse,
} from '@mwc/shared/runner-protocol';
import { postJson, TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from '../../../../src/platform/auth/api-keys.ts';
import { call } from '../../../fixtures/companies/companies.ts';
import {
  auditOf,
  DEVBOX,
  enroll,
  MAC,
  machineRow,
  machinesPath,
  makeToken,
} from '../../../fixtures/machines/machines.ts';
import { addMember, as, keyRow, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterEach(() => w.clock.set(TEST_NOW));
afterAll(() => w.t.close());

const enrollWith = (token: string, machine: object = MAC) =>
  postJson(w.t.app, '/api/runner/enroll', { ...machine, token });

const tokenRow = async (id: string) =>
  (await rawDb(w.t.db).select().from(enrollmentTokens).where(eq(enrollmentTokens.id, id)))[0];

describe('POST /api/companies/:companyId/machines/enrollment-tokens', () => {
  it('makes a one-time token for an admin or owner, good for an hour, and stores only its SHA-256', async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const res = await as(w, admin, 'req-et-1')('POST', machinesPath(company, '/enrollment-tokens'));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = res.body as { id: string; token: string; expiresAt: string };
    expect(body.token).toMatch(ENROLLMENT_TOKEN_PATTERN);
    expect(body.expiresAt).toBe(new Date(Date.parse(TEST_NOW) + ENROLLMENT_TOKEN_TTL_MS).toISOString());
    expect(await tokenRow(body.id)).toMatchObject({
      companyId: company.companyId,
      secretHash: hashApiKey(body.token),
      createdBy: admin.principalId,
      usedAt: null,
      machineId: null,
    });
    expect(await auditOf(w.t.db, 'enrollment_token', body.id)).toEqual([
      'create createdBy',
      'create expiresAt',
    ]);
    expect((await makeToken(w, company)).token).not.toBe(body.token);
  });

  it('is refused without a credential (401), below admin (403) and in another company (404)', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const path = machinesPath(company, '/enrollment-tokens');
    expect((await call(w, undefined)('POST', path)).status).toBe(401);
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, company, role);
      expect(await as(w, person)('POST', path)).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    expect((await as(w, other.owner)('POST', path)).status).toBe(404);
  });
});

describe('POST /api/runner/enroll', () => {
  it("makes the machine and its runner key (the token maker's), shown once, and uses the token", async () => {
    const company = await membersCompany(w);
    const admin = await addMember(w, company, 'admin');
    const { id, token } = await makeToken(w, company, admin);
    w.clock.advance(60_000);
    const res = await enrollWith(token, DEVBOX);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { machineId, companyId, runnerKey } = res.body as RunnerEnrollResponse;
    expect(companyId).toBe(company.companyId);
    expect(runnerKey).toMatch(API_KEY_PATTERN);
    expect(runnerKey.startsWith('mwc_rk_')).toBe(true);
    expect(await machineRow(w.t.db, machineId)).toMatchObject({
      ...DEVBOX,
      runnerVersion: '0.5.0',
      status: 'offline',
      slots: 1,
      lastSeenAt: null,
      removedAt: null,
    });
    const [key] = await rawDb(w.t.db).select().from(apiKeys).where(eq(apiKeys.machineId, machineId));
    expect(key).toMatchObject({
      kind: 'runner',
      principalId: admin.principalId,
      name: 'Airia devbox',
      prefix: runnerKey.slice(0, 11),
      secretHash: hashApiKey(runnerKey),
      expiresAt: null,
      revokedAt: null,
    });
    expect(await tokenRow(id)).toMatchObject({ usedAt: w.clock(), machineId });
    // Every field it was made with but Claude Code's version, which the devbox has none of (null).
    expect(await auditOf(w.t.db, 'machine', machineId)).toEqual(
      ['arch', 'hostname', 'kind', 'name', 'os', 'provider', 'providerRef', 'runnerVersion', 'unixUser'].map(
        (field) => `create ${field}`,
      ),
    );
    expect(await auditOf(w.t.db, 'api_key', key?.id as string)).toEqual([
      'create kind',
      'create machineId',
      'create name',
      'create prefix',
    ]);
    expect(await auditOf(w.t.db, 'enrollment_token', id)).toEqual([
      'create createdBy',
      'create expiresAt',
      'use machineId',
      'use usedAt',
    ]);
    expect(await keyRow(w.t.db, key?.id as string)).toMatchObject({ companyId: company.companyId });
    expect(await enroll(w, company)).toMatchObject({ companyId: company.companyId });
  });

  it('takes a token once: a second enrollment is a 401 and makes nothing', async () => {
    const company = await membersCompany(w);
    const { token } = await makeToken(w, company);
    expect((await enrollWith(token)).status).toBe(201);
    expect(await enrollWith(token)).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'The enrollment token was used already' } },
    });
  });

  it('refuses an expired, unknown or malformed token, and one of a deleted company (401)', async () => {
    const company = await membersCompany(w);
    const { token } = await makeToken(w, company);
    w.clock.advance(ENROLLMENT_TOKEN_TTL_MS);
    const expired = await enrollWith(token);
    expect(expired).toMatchObject({
      status: 401,
      body: { error: { message: 'The enrollment token has expired' } },
    });
    expect(expired.headers.get('www-authenticate')).toBe('Bearer');
    const unknown = `mwc_et_${'Q'.repeat(32)}`;
    expect(await enrollWith(unknown)).toMatchObject({
      status: 401,
      body: { error: { code: 'unauthenticated', message: 'The enrollment token is not valid' } },
    });
    w.clock.set(TEST_NOW);
    const gone = await membersCompany(w);
    const { token: orphan } = await makeToken(w, gone);
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'deleted', deletedAt: w.clock() })
      .where(eq(companies.id, gone.companyId));
    expect((await enrollWith(orphan)).status).toBe(401);
    expect(await enrollWith('mwc_et_short')).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request' } },
    });
  });

  it('refuses a body that does not match the schema (400)', async () => {
    const company = await membersCompany(w);
    const { token } = await makeToken(w, company);
    for (const bad of [
      { ...MAC, kind: 'phone' },
      { ...MAC, providerRef: { instance: 'x' } },
      { ...DEVBOX, providerRef: null },
    ]) {
      expect((await enrollWith(token, bad)).status).toBe(400);
    }
    expect((await enrollWith(token)).status).toBe(201);
  });
});
