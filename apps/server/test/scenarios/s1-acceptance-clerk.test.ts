import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemberView } from '../../src/modules/members/schemas.ts';
import { clerkRunWanted, clerkTarget } from '../fixtures/acceptance/clerk.ts';
import {
  expectActiveMember,
  type Founded,
  foundCompany,
  type Invited,
  inviteMember,
  membersOf,
  removeMember,
} from '../fixtures/acceptance/steps.ts';
import type { AcceptanceTarget, SignedIn } from '../fixtures/acceptance/target.ts';
import { type AcceptanceWorld, acceptanceWorld, aDayAhead } from '../fixtures/acceptance/world.ts';

/**
 * Steps 1, 2, 3 by the first sign-in, and 7 of the S1 acceptance (s1-acceptance.test.ts) against the real Clerk
 * development instance. Opt-in: it runs only with CLERK_CONTRACT_TEST=1 and a development CLERK_SECRET_KEY, which
 * `pnpm --filter @mwc/server acceptance:clerk` loads from the repository root's .env and .env.local. It makes
 * `mwc-contract-` users with `+clerk_test` emails and one organization, and deletes them afterwards, also when a step
 * fails (docs/testing.md, "S1 acceptance").
 */
const { requested, ready } = clerkRunWanted(process.env);
const TITLE = 'S1 acceptance on the Clerk development instance';

if (!requested || !ready) {
  describe(TITLE, () => {
    it.skip(
      requested
        ? 'needs a development CLERK_SECRET_KEY (sk_test_...) in .env or .env.local'
        : 'runs only on request: pnpm --filter @mwc/server acceptance:clerk',
      () => {},
    );
  });
} else {
  describe(TITLE, () => {
    const TIMEOUT = 120_000;
    let target: AcceptanceTarget | undefined;
    let w: AcceptanceWorld;
    let home: Founded;
    let invited: Invited;
    let second: SignedIn;
    let member: MemberView;

    beforeAll(async () => {
      target = await clerkTarget(process.env);
      w = await acceptanceWorld(target, aDayAhead());
    }, TIMEOUT);
    afterAll(async () => {
      await target?.cleanup();
      await w?.close();
    }, TIMEOUT);

    it(
      '1. the owner signs in with no companies, creates one, and a jobs tick makes its organization at Clerk',
      async () => {
        home = await foundCompany(w, 'owner', 'Ihor Herasko', 'Most Wanted');
      },
      TIMEOUT,
    );

    it(
      '2. the owner invites a +clerk_test email as a member, and a jobs tick sends the invitation with our metadata',
      async () => {
        invited = await inviteMember(w, home, 'second');
      },
      TIMEOUT,
    );

    it(
      '3. the invitee signs up with the ticket, and their first GET /api/me brings them in as an active member',
      async () => {
        second = await w.target.acceptBySignUp(invited.sent, 'second', 'Second Person');
        expect((await membersOf(w, home)).map((one) => one.email)).not.toContain(second.email);
        expect(await w.as(second)('GET', '/api/me')).toMatchObject({
          status: 200,
          body: { memberships: [{ companyId: home.company.id, role: 'member', status: 'active' }] },
        });
        member = await expectActiveMember(w, home, invited, second);
      },
      TIMEOUT,
    );

    it(
      '7. the owner removes them: 404 at once, and the outbox removes them at Clerk on the next tick',
      async () => {
        await removeMember(w, home, member, second);
      },
      TIMEOUT,
    );
  });
}
