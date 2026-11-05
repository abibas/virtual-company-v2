import { FAKE_ISSUER, seedCompany } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isUniqueViolation,
  meService,
  RECONCILE_TRIES,
  RecentKeys,
  retryOnUniqueViolation,
} from '../../../../src/modules/identity/service/me.ts';
import type { Actor } from '../../../../src/platform/auth/actor.ts';
import { type AuthWorld, addPerson, authWorld } from '../../../fixtures/auth.ts';
import { testChart } from '../../../fixtures/org.ts';

const unique = Object.assign(new Error('duplicate key'), { code: '23505' });

describe('isUniqueViolation', () => {
  it("finds SQLSTATE 23505 on the driver's error or as the cause of Drizzle's", () => {
    expect(isUniqueViolation(unique)).toBe(true);
    expect(isUniqueViolation(new Error('query failed', { cause: unique }))).toBe(true);
    expect(isUniqueViolation(new Error('a', { cause: new Error('b', { cause: unique }) }))).toBe(true);
  });

  it('is false for other errors, other codes, values that are not errors and causes too deep', () => {
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error('fk'), { code: '23503' }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    let deep: Error = unique;
    for (let i = 0; i < 4; i++) deep = new Error(`level ${i}`, { cause: deep });
    expect(isUniqueViolation(deep)).toBe(false);
  });
});

describe('retryOnUniqueViolation', () => {
  it('runs the work again after a unique violation', async () => {
    const work = vi.fn().mockRejectedValueOnce(unique).mockResolvedValueOnce('done');
    expect(await retryOnUniqueViolation(work)).toBe('done');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${RECONCILE_TRIES} tries, and at once on any other error`, async () => {
    const always = vi.fn().mockRejectedValue(unique);
    await expect(retryOnUniqueViolation(always)).rejects.toBe(unique);
    expect(always).toHaveBeenCalledTimes(RECONCILE_TRIES);
    const other = new Error('down');
    const failing = vi.fn().mockRejectedValue(other);
    await expect(retryOnUniqueViolation(failing)).rejects.toBe(other);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe('RecentKeys', () => {
  it('forgets the oldest key first, and a key added again becomes the newest', () => {
    const keys = new RecentKeys(2);
    keys.add('a');
    keys.add('b');
    keys.add('a');
    keys.add('c');
    expect([keys.has('a'), keys.has('b'), keys.has('c')]).toEqual([true, false, true]);
  });
});

describe('meService', () => {
  let w: AuthWorld;
  let actor: (subject: string, sessionId?: string) => Actor;
  beforeAll(async () => {
    w = await authWorld();
    actor = (subject, sessionId) => ({
      kind: 'user',
      via: 'clerk',
      identity: { issuer: FAKE_ISSUER, subject, pending: false, ...(sessionId ? { sessionId } : {}) },
    });
  });
  afterAll(() => w.t.close());
  const deps = () => ({ ...w.deps, chart: testChart() });

  it('reconciles a session again once it has been forgotten', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const service = meService(deps(), { rememberedSessions: 1 });
    const linked = (sessionId: string) => ({ ...actor(person.subject, sessionId), userId: person.userId });
    const getUser = vi.spyOn(w.fake, 'getUser');
    for (const sessionId of ['s1', 's1', 's2', 's1']) await service.me(linked(sessionId), w.clock);
    expect(getUser).toHaveBeenCalledTimes(3);
    getUser.mockRestore();
  });

  it('without a session id, reconciles only a person who is not linked yet', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const service = meService(deps());
    const getUser = vi.spyOn(w.fake, 'getUser');
    expect(await service.me({ ...actor(person.subject), userId: person.userId }, w.clock)).toMatchObject({
      ok: true,
    });
    expect(getUser).not.toHaveBeenCalled();
    w.fake.createUser({ subject: 'no_session', email: 'no-session@x.test' });
    expect(await service.me(actor('no_session'), w.clock)).toMatchObject({
      ok: true,
      me: { memberships: [] },
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    getUser.mockRestore();
  });

  it('reads the local user without a provider (sign-in off)', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const service = meService({ ...deps(), identity: undefined });
    const result = await service.me({ ...actor(person.subject, 's'), userId: person.userId }, w.clock);
    expect(result).toMatchObject({ ok: true, me: { user: { id: person.userId } } });
  });

  it('refuses a self reconcile without a session identity or without a provider', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const refused = { ok: false, status: 403, code: 'forbidden' };
    const viaKey: Actor = { kind: 'user', via: 'api_key', userId: person.userId, companyId: company.id };
    expect(await meService(deps()).reconcile(viaKey, w.clock)).toMatchObject(refused);
    const signedIn = { ...actor(person.subject, 's'), userId: person.userId };
    expect(await meService({ ...deps(), identity: undefined }).reconcile(signedIn, w.clock)).toMatchObject(
      refused,
    );
  });

  it('reconciles a session it reconciled already when asked, one turn per person per interval', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const service = meService(deps(), { selfReconcileIntervalMs: 2_000 });
    const linked = { ...actor(person.subject, 's1'), userId: person.userId };
    const getUser = vi.spyOn(w.fake, 'getUser');
    await service.me(linked, w.clock);
    await service.me(linked, w.clock);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(await service.reconcile(linked, w.clock)).toMatchObject({ ok: true });
    expect(getUser).toHaveBeenCalledTimes(2);
    w.clock.advance(500);
    expect(await service.reconcile(linked, w.clock)).toEqual({
      ok: false,
      status: 429,
      code: 'rate_limited',
      retryAfterMs: 1_500,
    });
    w.clock.advance(1_500);
    expect(await service.reconcile(linked, w.clock)).toMatchObject({ ok: true });
    expect(getUser).toHaveBeenCalledTimes(3);
    getUser.mockRestore();
  });
});
