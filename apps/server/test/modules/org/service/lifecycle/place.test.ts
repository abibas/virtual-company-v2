import type { StoredMembership } from '@mwc/identity-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbIdentityStore } from '../../../../../src/modules/identity/repo.ts';
import type { MemberView } from '../../../../../src/modules/members/schemas.ts';
import { deliverEvents } from '../../../../fixtures/identity/webhooks.ts';
import {
  acceptAtProvider,
  invite,
  memberWithEmail,
  runOutbox,
} from '../../../../fixtures/members/invitations.ts';
import { as, type MembersCompany, memberPath, membersCompany } from '../../../../fixtures/members/members.ts';
import {
  acceptedFrom,
  LEARNING_PATHS,
  learnBy,
  managersOf,
  orgCompany,
  placedMember,
  placeOf,
  positionAudit,
  testChart,
} from '../../../../fixtures/org.ts';
import { type AuthWorld, addPerson, authWorld } from '../../../../fixtures/platform/auth.ts';

// A membership that becomes active places its person on the org chart (S2.4), whatever the path: under whoever
// invited them, else under the company's earliest active owner, once.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const principalOf = async (company: MembersCompany, email: string) =>
  (await memberWithEmail(w, company, email))?.principalId as string;

/** The database identity store, as the identity paths open it, with `requestId` on its chart's audit rows. */
const store = (requestId: string) =>
  dbIdentityStore(w.t.db, { provider: 'fake', chart: testChart(), requestId });

/** Writes a membership's status through the store, as the projector does. */
async function setStatus(
  companyId: string,
  userId: string,
  status: StoredMembership['status'],
  requestId: string,
) {
  const s = store(requestId);
  const { id: _id, ...membership } = (await s.getMembership(companyId, userId)) as StoredMembership;
  return s.upsertMembership({ ...membership, status });
}

describe.each(LEARNING_PATHS)('a membership that becomes active, learned by %s', (path) => {
  it('places the person under whoever invited them, once, by the system', async () => {
    const company = await orgCompany(w);
    const joiner = await acceptedFrom(w, company, company.admin);
    const requestId = await learnBy(w, company, path, { ...joiner, label: 'join' });
    const principalId = await principalOf(company, joiner.email);
    const admin = company.admin.principalId;
    expect(await managersOf(w, company, [principalId])).toEqual([admin]);
    expect(await positionAudit(w, principalId)).toEqual([['create', 'system', requestId, null, admin]]);
    // The same path again (another delivery, session or turn) leaves the place as it is.
    await learnBy(w, company, path, { ...joiner, label: 'join' }, 2);
    expect(await managersOf(w, company, [principalId])).toEqual([admin]);
    expect(await positionAudit(w, principalId)).toHaveLength(1);
  });

  it('places the person under the manager their invitation names, ahead of whoever invited them', async () => {
    const company = await orgCompany(w);
    const lead = await placedMember(w, company, 'member', { reportsTo: company.admin.principalId });
    const joiner = await acceptedFrom(w, company, company.owner, 'member', lead.principalId);
    const requestId = await learnBy(w, company, path, { ...joiner, label: 'join' });
    const principalId = await principalOf(company, joiner.email);
    expect(await managersOf(w, company, [principalId])).toEqual([lead.principalId]);
    expect(await positionAudit(w, principalId)).toEqual([
      ['create', 'system', requestId, null, lead.principalId],
    ]);
  });

  it('places them under the earliest owner when whoever invited them has left meanwhile', async () => {
    const company = await orgCompany(w);
    const joiner = await acceptedFrom(w, company, company.admin);
    expect((await as(w, company.owner)('DELETE', memberPath(company, company.admin))).status).toBe(204);
    await learnBy(w, company, path, { ...joiner, label: 'join' });
    const principalId = await principalOf(company, joiner.email);
    expect(await managersOf(w, company, [principalId, company.admin.principalId])).toEqual([
      company.owner.principalId,
      undefined,
    ]);
  });
});

describe('placing a person who joins', () => {
  it("falls back on whoever invited them when the invitation's manager has left meanwhile", async () => {
    const company = await orgCompany(w);
    const lead = await placedMember(w, company, 'member');
    const joiner = await acceptedFrom(w, company, company.admin, 'member', lead.principalId);
    const removal = await as(w, company.owner)('DELETE', memberPath(company, lead));
    expect(removal.status).toBe(204);
    await deliverEvents(w, joiner.events);
    const principalId = await principalOf(company, joiner.email);
    expect(await managersOf(w, company, [principalId])).toEqual([company.admin.principalId]);
  });

  it('puts an owner invited by an owner under them, not at the top', async () => {
    const company = await membersCompany(w);
    const second = await placedMember(w, company, 'owner');
    const joiner = await acceptedFrom(w, company, second, 'owner');
    await deliverEvents(w, joiner.events);
    const principalId = await principalOf(company, joiner.email);
    expect(await managersOf(w, company, [second.principalId, principalId])).toEqual([
      company.owner.principalId,
      second.principalId,
    ]);
  });

  it('places someone removed and invited again under whoever invited them this time', async () => {
    const company = await orgCompany(w);
    const first = await acceptedFrom(w, company, company.admin);
    await deliverEvents(w, first.events);
    const member = (await memberWithEmail(w, company, first.email)) as MemberView;
    expect((await as(w, company.owner)('DELETE', memberPath(company, member.id))).status).toBe(204);
    await runOutbox(w, company.companyId);
    expect(await placeOf(w.t.db, company.companyId, member.principalId)).toBeUndefined();
    const sent = await invite(w, company, first.email, 'member', company.owner);
    await runOutbox(w, company.companyId);
    w.fake.drainEvents();
    await acceptAtProvider(w, sent.id, first.subject);
    await deliverEvents(w, w.fake.drainEvents());
    expect(await memberWithEmail(w, company, first.email)).toMatchObject({ id: member.id, status: 'active' });
    expect(await managersOf(w, company, [member.principalId])).toEqual([company.owner.principalId]);
  });

  it('puts an owner added with no invitation under the earliest owner, or at the top when there is none', async () => {
    const company = await membersCompany(w);
    const second = await addPerson(w.t.db, w.fake, company.companyId, { role: 'owner', status: 'invited' });
    await setStatus(company.companyId, second.userId, 'active', 'req-second');
    expect(await managersOf(w, company, [second.principalId])).toEqual([company.owner.principalId]);
    expect(await positionAudit(w, second.principalId)).toEqual([
      ['create', 'system', 'req-second', null, company.owner.principalId],
    ]);
    const alone = await membersCompany(w);
    await setStatus(alone.companyId, alone.owner.userId, 'suspended', 'req-suspend');
    const first = await addPerson(w.t.db, w.fake, alone.companyId, { role: 'owner', status: 'invited' });
    await setStatus(alone.companyId, first.userId, 'active', 'req-first');
    expect(await placeOf(w.t.db, alone.companyId, first.principalId)).toEqual([null, null]);
    // A place at the top is audited too.
    expect(await positionAudit(w, first.principalId)).toEqual([
      ['create', 'system', 'req-first', null, null],
    ]);
  });

  it('leaves alone a place a returning person still has (one left behind before S2.4)', async () => {
    const company = await orgCompany(w);
    const back = await placedMember(w, company, 'member', {
      reportsTo: company.admin.principalId,
      status: 'removed',
    });
    await setStatus(company.companyId, back.userId, 'active', 'req-back');
    expect(await managersOf(w, company, [back.principalId])).toEqual([company.admin.principalId]);
    expect(await positionAudit(w, back.principalId)).toEqual([]);
  });
});
