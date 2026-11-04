/**
 * The real Clerk development instance as the S1 acceptance scenario's target, for the opt-in run
 * (`pnpm --filter @mwc/server acceptance:clerk`, docs/testing.md "S1 acceptance"). It reuses the Clerk connector's
 * contract fixtures (`connectors/identity-clerk/test/fixtures/clerk-target.ts`, with its Frontend API client
 * `fapi.ts`), loaded only when the run starts, so the default lanes never load the Clerk SDK: users are made through
 * the Backend API with `mwc-contract-<random>-<label>+clerk_test@example.com` emails (no email is sent), sign in on the
 * Frontend API with a sign-in token, and the invitee signs up with the invitation's ticket. Their session tokens carry
 * the contract's origin as `azp`, which the app is configured with. `cleanup` deletes the run's organizations and
 * users, also after a failure.
 */
import { CONTRACT_WEB_ORIGIN } from '@mwc/testkit/provider-contract';
import type { AcceptanceTarget } from './target.ts';

/** Whether this environment may run against Clerk: the opt-in switch and a development secret key (never printed). */
export function clerkRunWanted(env: Readonly<Record<string, string | undefined>>) {
  return {
    requested: env.CLERK_CONTRACT_TEST === '1',
    ready: /^sk_test_[A-Za-z0-9]{20,}$/.test(env.CLERK_SECRET_KEY ?? ''),
  };
}

export async function clerkTarget(
  env: Readonly<Record<string, string | undefined>>,
): Promise<AcceptanceTarget> {
  const { clerkContractTarget } = await import(
    '../../../../../connectors/identity-clerk/test/fixtures/clerk-target.ts'
  );
  const clerk = clerkContractTarget(env);
  return {
    provider: clerk.provider,
    webOrigin: CONTRACT_WEB_ORIGIN,
    email: (label) => clerk.email(label),
    companyName: (name) => `${clerk.runId} ${name}`,
    async signUp(label, displayName) {
      const user = await clerk.createUser(label, displayName);
      const session = await clerk.signIn(user.subject);
      return { subject: user.subject, email: clerk.email(label), token: session.token };
    },
    async acceptBySignUp(invitation) {
      const session = await clerk.signUpWithInvitation(invitation);
      return { subject: session.subject, email: invitation.email, token: session.token };
    },
    cleanup: () => clerk.cleanup(),
  };
}
