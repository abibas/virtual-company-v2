import { getJson, seedCompany } from '@mwc/testkit';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authn } from '../../../src/platform/auth/authn.ts';
import { personalRoute, requireSession } from '../../../src/platform/auth/personal.ts';
import type { AppEnv } from '../../../src/platform/env.ts';
import { errorHandler } from '../../../src/platform/http/errors.ts';
import {
  type AuthWorld,
  addPerson,
  authWorld,
  bearer,
  newSubject,
  seedApiKey,
} from '../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
  w.t.app.get('/api/me/probe', authn(w.deps), requireSession(), (c) => c.json({ userId: c.var.userId }));
});
afterAll(() => w.t.close());

const probe = (token: string) => getJson(w.t.app, '/api/me/probe', bearer(token));

describe('requireSession', () => {
  it('lets in a person signed in with a session, and names them', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    expect(await probe(`fake:${person.subject}`)).toMatchObject({
      status: 200,
      body: { userId: person.userId },
    });
  });

  it("refuses the same person's API key with 403 session_required", async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const res = await probe(key);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'session_required' } });
  });

  it('refuses a session whose person is not linked here yet (403 user_not_linked)', async () => {
    const subject = newSubject('unlinked');
    w.fake.createUser({ subject, email: `${subject}@people.test` });
    const res = await probe(`fake:${subject}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'user_not_linked' } });
  });

  it('is a programming error without authn() in front of it (500)', async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorHandler(w.t.logger));
    app.use(async (c, next) => {
      c.set('requestId', 'req-wiring');
      await next();
    });
    app.get('/api/me/bare', requireSession(), (c) => c.text('no'));
    expect((await app.request('/api/me/bare')).status).toBe(500);
  });

  it("documents a personal route's guard and refusals", () => {
    const { base, refusals } = personalRoute(w.deps, { path: '/api/me/things', tag: 'things' });
    expect(base).toMatchObject({ path: '/api/me/things', tags: ['things'], security: [{ bearer: [] }] });
    expect(base.middleware).toHaveLength(2);
    expect(Object.keys(refusals)).toEqual(['401', '403', '503']);
    expect(refusals[403].description).toContain('`session_required`');
  });
});
