import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemberView } from '../../src/modules/members/schemas.ts';
import { expectAuditTrail, expectStrangers } from '../fixtures/acceptance/checks.ts';
import { ACCEPTANCE_PATHS, type Acceptance, acceptBy, SECOND_NAME } from '../fixtures/acceptance/paths.ts';
import {
  expectActiveMember,
  expectNoAdminRights,
  type Founded,
  foundCompany,
  type Invited,
  inviteMember,
  makeApiKey,
  promoteToAdmin,
  removeMember,
} from '../fixtures/acceptance/steps.ts';
import { type FakeTarget, fakeTarget } from '../fixtures/acceptance/target.ts';
import { type AcceptanceWorld, acceptanceWorld, aDayAhead } from '../fixtures/acceptance/world.ts';

/**
 * The S1 acceptance (docs/roadmap.md, S1; docs/testing.md, "S1 acceptance"), as one story over the real HTTP API on
 * the fake identity provider, once per acceptance path, each on a fresh database (PGlite, or Postgres in `--full`):
 * Ihor founds a company, invites a second person, who accepts and is found active as a member, cannot administer,
 * is promoted to admin, makes an API key, and is removed, losing access at once; every change is audited, and a third
 * company owned by someone else stays out of sight throughout. The steps share their state in order.
 */
describe.each(ACCEPTANCE_PATHS)('S1 acceptance, the invitation accepted by %s', (path) => {
  let w: AcceptanceWorld<FakeTarget>;
  let home: Founded;
  let stranger: Founded;
  let invited: Invited;
  let accepted: Acceptance;
  let member: MemberView;
  let key: string;

  beforeAll(async () => {
    const clock = aDayAhead();
    w = await acceptanceWorld(fakeTarget(clock), clock);
  });
  afterAll(() => w.close());

  it('1. Ihor signs in with no companies, creates one, and a jobs tick makes its organization', async () => {
    home = await foundCompany(w, 'ihor', 'Ihor Herasko', 'Most Wanted');
    expect(home.owner.email).toBe('ihor+clerk_test@example.com');
    // 9. A third company, owned by someone else, from the start.
    stranger = await foundCompany(w, 'stranger', 'Sam Stranger', 'Elsewhere');
    await expectStrangers(w, home, stranger, []);
  });

  it('2. he invites second+clerk_test@example.com as a member, and a jobs tick sends the invitation', async () => {
    invited = await inviteMember(w, home, 'second');
    expect(invited.invitation.email).toBe('second+clerk_test@example.com');
  });

  it(`3. the second person accepts (${path}): an active member, the invitation accepted`, async () => {
    accepted = await acceptBy(path, w, home, invited);
    member = await expectActiveMember(w, home, invited, accepted.person);
    expect(member.displayName).toBe(SECOND_NAME);
    await expectStrangers(w, home, stranger, [accepted.person]);
  });

  it('4. as a member they read the company but get 403 on the admin routes', async () => {
    await expectNoAdminRights(w, home, accepted.person);
  });

  it('5. Ihor promotes them to admin, the outbox pushes the role, and they can invite', async () => {
    await promoteToAdmin(w, home, member, accepted.person);
  });

  it('6. they make a personal API key, and GET /api/me with it answers as them', async () => {
    key = await makeApiKey(w, home, accepted.person);
    await expectStrangers(w, home, stranger, [accepted.person], key);
  });

  it('7. Ihor removes them: 404 for the session and 401 for the key at once, gone at the provider next tick', async () => {
    await removeMember(w, home, member, accepted.person, key);
    await expectStrangers(w, home, stranger, [accepted.person]);
  });

  it('8. every change has its audit rows, with the actor and the request id', async () => {
    const owner = home.ownerPrincipalId;
    const second = member.principalId;
    await expectAuditTrail(
      w,
      home,
      [
        { label: 'ihor-creates-company', principalId: owner, entity: 'company', action: 'create' },
        { label: 'owner-invites', principalId: owner, entity: 'invitation', action: 'create' },
        { label: 'owner-promotes', principalId: owner, entity: 'membership', action: 'update' },
        { label: 'admin-invites', principalId: second, entity: 'invitation', action: 'create' },
        { label: 'admin-creates-key', principalId: second, entity: 'api_key', action: 'create' },
        { label: 'owner-removes', principalId: owner, entity: 'membership', action: 'remove' },
        { label: 'owner-removes', principalId: owner, entity: 'api_key', action: 'revoke' },
      ],
      accepted.auditRequestIds,
    );
  });
});
