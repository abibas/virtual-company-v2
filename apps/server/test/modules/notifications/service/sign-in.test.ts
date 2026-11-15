import { newId } from '@mwc/shared/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noticeSignInNeeded } from '../../../../src/modules/notifications/service.ts';
import { addUser, joinCompany } from '../../../fixtures/companies/companies.ts';
import { type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { inboxOf, rowsFor, rowsOf } from '../../../fixtures/notifications.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

/**
 * A tool sign-in its provider refused (T-22, docs/subscriptions.md "The sign-in's owner hears of it"): its owner hears
 * of it in every company where their membership is active, from the system, once per change of the sign-in (its
 * `updated_at`), pointing at their sign-ins.
 */

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const CHANGE = new Date('2026-11-14T10:00:00.000Z');

/** A sign-in of the owner's that stopped working, as `recordToolCheck` names it. */
const broken = (ownerUserId: string, fields: { id?: string; updatedAt?: Date; label?: string } = {}) => ({
  id: fields.id ?? newId(),
  ownerUserId,
  label: fields.label ?? 'Slack Airia Bro',
  kind: 'slack_bot_token',
  updatedAt: fields.updatedAt ?? CHANGE,
});

/** The owner of `home`, also a member elsewhere: active in `other`, suspended in `suspended`, invited in `invited`. */
async function ownerOfSeveral() {
  const home = await membersCompany(w);
  const [other, suspended, invited] = [
    await membersCompany(w),
    await membersCompany(w),
    await membersCompany(w),
  ];
  const userId = home.owner.userId;
  const inOther = await joinCompany(w.t.db, other.companyId, userId, 'member');
  await joinCompany(w.t.db, suspended.companyId, userId, 'member', 'suspended');
  await joinCompany(w.t.db, invited.companyId, userId, 'member', 'invited');
  return { home, other, suspended, invited, userId, inOther: inOther.principalId };
}

const kindsIn = async (company: MembersCompany) =>
  (await rowsOf(w.t.db, company.companyId)).filter(([, kind]) => kind === 'sign_in_needed');

describe('noticeSignInNeeded', () => {
  it('tells the owner in each company where they are active, from the system, naming the sign-in and the change', async () => {
    const { home, other, suspended, invited, userId, inOther } = await ownerOfSeveral();
    const signIn = broken(userId);
    expect(await noticeSignInNeeded(w.t.db, signIn)).toBe(2);
    expect(await kindsIn(home)).toEqual([[home.owner.principalId, 'sign_in_needed', null]]);
    expect(await kindsIn(other)).toEqual([[inOther, 'sign_in_needed', null]]);
    expect(await kindsIn(suspended)).toEqual([]);
    expect(await kindsIn(invited)).toEqual([]);
    const [row] = await rowsFor(w.t.db, other.companyId, inOther);
    expect(row?.payload).toEqual({
      about: inOther,
      detail: 'Slack Airia Bro',
      signIn: signIn.id,
      signInKind: 'slack_bot_token',
      change: CHANGE.toISOString(),
    });
    const [notice] = (await inboxOf(w, home, home.owner)).notifications;
    expect(notice).toMatchObject({
      kind: 'sign_in_needed',
      text: "'Slack Airia Bro' stopped working: Slack refused its token. Add it again",
      actor: null,
      path: 'subscriptions',
    });
  });

  it('tells each change once: the same change again says nothing, a later one or another sign-in is told', async () => {
    const { home, other, userId } = await ownerOfSeveral();
    const signIn = broken(userId);
    expect(await noticeSignInNeeded(w.t.db, signIn)).toBe(2);
    expect(await noticeSignInNeeded(w.t.db, signIn)).toBe(0);
    expect(await noticeSignInNeeded(w.t.db, { ...signIn, label: 'Renamed' })).toBe(0);
    const later = { ...signIn, updatedAt: new Date(CHANGE.getTime() + 60_000) };
    expect(await noticeSignInNeeded(w.t.db, later)).toBe(2);
    expect(await noticeSignInNeeded(w.t.db, later)).toBe(0);
    expect(await noticeSignInNeeded(w.t.db, broken(userId, { label: 'Another' }))).toBe(2);
    expect(await kindsIn(home)).toHaveLength(3);
    expect(await kindsIn(other)).toHaveLength(3);
    const texts = (await inboxOf(w, home, home.owner)).notifications.map((notice) => notice.text);
    expect(texts).toEqual([
      "'Another' stopped working: Slack refused its token. Add it again",
      "'Slack Airia Bro' stopped working: Slack refused its token. Add it again",
      "'Slack Airia Bro' stopped working: Slack refused its token. Add it again",
    ]);
  });

  it('tells nobody else, and nobody when the owner is a member nowhere', async () => {
    const { other, userId, inOther } = await ownerOfSeveral();
    expect(await noticeSignInNeeded(w.t.db, broken(userId))).toBe(2);
    expect(await rowsFor(w.t.db, other.companyId, other.owner.principalId)).toEqual([]);
    expect((await kindsIn(other)).map(([recipient]) => recipient)).toEqual([inOther]);
    const loner = await addUser(w.t.db, w.fake);
    expect(await noticeSignInNeeded(w.t.db, broken(loner.userId))).toBe(0);
  });
});
