import { CONTRACT_WEB_ORIGIN, describeProviderContract } from '@mwc/testkit/provider-contract';
import { describe, expect, it } from 'vitest';
import { type ClerkContractTarget, clerkContractTarget, contractLeftovers } from './fixtures/clerk-target.ts';

/**
 * The provider contract against the real Clerk development instance (docs/clerk-setup.md). Opt-in: it
 * runs only with CLERK_CONTRACT_TEST=1 and the keys in the environment, which
 * `pnpm --filter @mwc/identity-clerk contract` loads from the repo root's .env and .env.local. Everything
 * it creates starts with `mwc-contract-` and is deleted afterwards, also when a case fails.
 */
const enabled = process.env.CLERK_CONTRACT_TEST === '1';

if (!enabled) {
  describe('IdentityProvider contract: Clerk development instance', () => {
    it.skip('runs only on request: pnpm --filter @mwc/identity-clerk contract', () => {});
  });
} else {
  const TIMEOUT = 60_000;
  let target: ClerkContractTarget | undefined;

  describeProviderContract(
    'Clerk development instance',
    () => {
      target = clerkContractTarget(process.env);
      return target;
    },
    { timeoutMs: TIMEOUT },
  );

  describe('Clerk development instance: beyond the contract', () => {
    const settled = () => {
      if (!target) throw new Error('the contract target was not created');
      return target;
    };

    it(
      'has the settings of docs/clerk-setup.md (Backend API)',
      async (context) => {
        const { clerk } = settled();
        expect((await clerk.instance.get()).environmentType).toBe('development');
        const organizations = await clerk.instance.getOrganizationSettings();
        expect(organizations).toMatchObject({
          enabled: true,
          maxAllowedMemberships: 5,
          creatorRole: 'org:admin',
        });
        // Recorded, not required: the connector sends no slug, so either value works.
        context.annotate(`organization slugs disabled: ${organizations.slugDisabled}`);
      },
      TIMEOUT,
    );

    it(
      'has the settings of docs/clerk-setup.md (Frontend API environment)',
      async (context) => {
        const environment = await (await settled().fapi()).environment();
        if ('unverified' in environment) return context.skip(environment.unverified);
        const { user_settings: user, organization_settings: orgs } = environment.ok as {
          user_settings?: Record<string, Record<string, Record<string, unknown>>>;
          organization_settings?: Record<string, unknown>;
        };
        expect(user?.attributes?.email_address).toMatchObject({
          enabled: true,
          required: true,
          verify_at_sign_up: true,
        });
        expect(user?.attributes?.email_address?.first_factors).toContain('email_code');
        expect(user?.social?.oauth_google).toMatchObject({ enabled: true });
        expect(orgs).toMatchObject({ enabled: true, max_allowed_memberships: 5 });
        // Recorded, not required: the ticket sign-up completes either way (it sends a password when asked for one).
        const password = user?.attributes?.password;
        context.annotate(`password: enabled ${password?.enabled}, required at sign-up ${password?.required}`);
        context.annotate(
          `organization settings keys: ${Object.keys(orgs ?? {})
            .sort()
            .join(', ')}`,
        );
      },
      TIMEOUT,
    );

    it('sends the invitation link to /accept-invitation with the ticket and __clerk_status=sign_up', (context) => {
      const { link } = settled().findings;
      if (link === undefined)
        return context.skip('no invitation link was followed (see the acceptance case)');
      expect(link).toEqual({ landing: `${CONTRACT_WEB_ORIGIN}/accept-invitation`, status: 'sign_up' });
    });

    it("checks a Frontend API session token's azp: accepted for our origin, refused for another", (context) => {
      const { azp } = settled().findings;
      if (azp === undefined) return context.skip('no invitee signed up (see the acceptance case)');
      if ('unverified' in azp) return context.skip(azp.unverified);
      expect(azp).toEqual({ verifiedForOrigin: true, refusedForOtherParty: true });
    });

    it(
      'leaves no mwc-contract- users or organizations behind',
      async () => {
        // The contract suite's cleanup ran in its afterAll, before this suite.
        expect(await contractLeftovers(settled().clerk)).toEqual({ users: [], orgs: [] });
      },
      TIMEOUT,
    );
  });
}
