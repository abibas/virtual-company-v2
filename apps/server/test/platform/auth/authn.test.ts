import { brokenDb, createTestApp, getJson, seedCompany, type TestApp, testConfig } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuthWorld, addPerson, authWorld, bearer, mountProbe } from '../../fixtures/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const runToken = [
  'eyJhbGciOiJFZERTQSJ9',
  Buffer.from('{"typ":"run","rid":"r1"}').toString('base64url'),
  'x',
].join('.');

describe('authn(): the credential', () => {
  it.each([
    ['no Authorization header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['a bearer without a token', 'Bearer '],
    ['a run token (S4)', `Bearer ${runToken}`],
  ])('refuses %s with 401 unauthenticated and a Bearer challenge', async (_label, header) => {
    const { company } = await seedCompany(w.t.db);
    const res = await getJson(
      w.t.app,
      `/api/companies/${company.id}/probe/viewer`,
      header === undefined ? {} : { authorization: header },
    );
    expect(res).toMatchObject({ status: 401, body: { error: { code: 'unauthenticated' } } });
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('puts the actor on the context for a valid session token', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const res = await getJson(
      w.t.app,
      `/api/companies/${company.id}/probe/viewer`,
      bearer(`fake:${person.subject}`),
    );
    expect(res).toMatchObject({
      status: 200,
      body: {
        actor: {
          kind: 'user',
          via: 'clerk',
          userId: person.userId,
          sessionId: `sess_${person.subject}`,
          identity: { subject: person.subject, pending: false },
        },
      },
    });
  });
});

describe('authn() without an identity provider (MWC_IDENTITY=none)', () => {
  let off: TestApp;
  beforeAll(async () => {
    // Without a provider nothing reaches the database.
    off = await createTestApp({ db: brokenDb() });
    mountProbe(off.app, { db: off.db, config: testConfig, logger: off.logger, identity: undefined });
  });
  afterAll(() => off.close());

  it('answers 503 identity_not_configured on identity routes, whatever the credential', async () => {
    expect(testConfig.MWC_IDENTITY).toBe('none');
    for (const headers of [{}, bearer('fake:anyone'), bearer('mwc_pk_00000000000000000000000000000000')]) {
      for (const path of [
        '/api/me',
        `/api/companies/${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}/probe/viewer`,
      ]) {
        expect(await getJson(off.app, path, headers)).toMatchObject({
          status: 503,
          body: { error: { code: 'identity_not_configured' } },
        });
      }
    }
  });

  it('keeps /healthz ok', async () => {
    expect(await getJson(off.app, '/healthz')).toMatchObject({ status: 200, body: { status: 'ok' } });
  });
});
