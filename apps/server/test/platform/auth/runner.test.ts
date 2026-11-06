import { apiKeys, companies, machines } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { getJson, seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRunnerKey } from '../../../src/platform/auth/api-keys.ts';
import { authnRunner } from '../../../src/platform/auth/runner.ts';
import {
  type AuthWorld,
  addPerson,
  authWorld,
  bearer,
  newApiKey,
  type Person,
  seedApiKey,
} from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
let companyId: string;
let person: Person;
beforeAll(async () => {
  w = await authWorld();
  companyId = (await seedCompany(w.t.db)).company.id;
  person = await addPerson(w.t.db, w.fake, companyId, { role: 'admin' });
  // A probe behind the runner's authentication alone (the socket route adds the upgrade).
  w.t.app.get('/probe/runner', authnRunner(w.deps), (c) => c.json(c.var.runner));
});
afterAll(() => w.t.close());

const runnerKey = () => seedApiKey(w.t.db, { companyId, principalId: person.principalId, kind: 'runner' });
const keyRow = async (id: string) =>
  (await rawDb(w.t.db).select().from(apiKeys).where(eq(apiKeys.id, id)))[0];
const probe = (headers: Record<string, string> = {}) => getJson(w.t.app, '/probe/runner', headers);

describe('authnRunner', () => {
  it("puts a runner key's machine, company and row on c.var.runner, and records the use", async () => {
    const { key, id } = await runnerKey();
    const row = await keyRow(id);
    const res = await probe(bearer(key));
    expect(res).toMatchObject({
      status: 200,
      body: { companyId, machineId: row?.machineId, apiKeyId: id },
    });
    expect((await keyRow(id))?.lastUsedAt).toEqual(w.clock());
  });

  it('is a 401 with WWW-Authenticate for no header, a personal key, a session or an unknown runner key', async () => {
    const personal = await seedApiKey(w.t.db, { companyId, principalId: person.principalId });
    for (const headers of [
      {},
      bearer(personal.key),
      bearer(`fake:${person.subject}`),
      bearer(newApiKey('rk')),
    ]) {
      const res = await probe(headers);
      expect(res).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } });
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
    }
  });
});

describe('checkRunnerKey', () => {
  const check = (key: string) => checkRunnerKey(w.t.db, key, w.clock(), w.t.logger);

  it('refuses a revoked or expired key, a removed machine and a deleted company', async () => {
    const revoked = await seedApiKey(w.t.db, {
      companyId,
      principalId: person.principalId,
      kind: 'runner',
      revokedAt: w.clock(),
    });
    expect(await check(revoked.key)).toMatchObject({
      ok: false,
      status: 401,
      message: 'The runner key was revoked',
    });
    const expired = await seedApiKey(w.t.db, {
      companyId,
      principalId: person.principalId,
      kind: 'runner',
      expiresAt: w.clock(),
    });
    expect(await check(expired.key)).toMatchObject({ ok: false, message: 'The runner key has expired' });
    const removed = await runnerKey();
    const machineId = (await keyRow(removed.id))?.machineId as string;
    await rawDb(w.t.db).update(machines).set({ removedAt: w.clock() }).where(eq(machines.id, machineId));
    expect(await check(removed.key)).toMatchObject({ ok: false, message: 'The machine was removed' });

    const gone = (await seedCompany(w.t.db)).company.id;
    const owner = await addPerson(w.t.db, w.fake, gone);
    const orphan = await seedApiKey(w.t.db, {
      companyId: gone,
      principalId: owner.principalId,
      kind: 'runner',
    });
    expect((await check(orphan.key)).ok).toBe(true);
    await rawDb(w.t.db).update(companies).set({ status: 'deleted' }).where(eq(companies.id, gone));
    expect(await check(orphan.key)).toMatchObject({ ok: false, message: 'The runner key is not valid' });
    await rawDb(w.t.db)
      .update(companies)
      .set({ status: 'active', deletedAt: w.clock() })
      .where(eq(companies.id, gone));
    expect(await check(orphan.key)).toMatchObject({ ok: false, message: 'The runner key is not valid' });
  });
});
