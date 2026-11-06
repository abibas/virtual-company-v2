/**
 * The identity provider the S1 acceptance scenario runs against, as a target: the fake provider in every lane
 * (`fakeTarget`), the real Clerk development instance on request (`clerk.ts`). A target makes people who sign up and
 * stay signed in, lets an invitee accept an invitation by signing up with its ticket (what the emailed link does), and
 * cleans up after itself.
 */
import type { IdentityProvider } from '@mwc/identity-core';
import type { ExternalInvitation } from '@mwc/shared/identity';
import { FakeIdentityProvider, type TestClock, testConfig } from '@mwc/testkit';
import { newSubject } from '../platform/auth.ts';

/** Someone signed in at the target's provider. */
export interface SignedIn {
  readonly subject: string;
  readonly email: string;
  /** A session token of their session (asked for afresh where the provider's tokens are short-lived). */
  token(): Promise<string>;
}

export interface AcceptanceTarget {
  readonly provider: IdentityProvider;
  /** The app's MWC_WEB_ORIGIN: the origin the target's session tokens are issued to (`azp`). */
  readonly webOrigin: string;
  /** A test email for `label`: `<label>+clerk_test@example.com` on the fake, the run's own on Clerk. */
  email(label: string): string;
  /** A company name the target's cleanup finds again (the run's prefix on Clerk). */
  companyName(name: string): string;
  /** A person signs up at the provider by themselves and signs in. */
  signUp(label: string, displayName: string): Promise<SignedIn>;
  /** The invitee signs up with the ticket of this provider invitation, which accepts it, and is signed in. */
  acceptBySignUp(invitation: ExternalInvitation, label: string, displayName: string): Promise<SignedIn>;
  cleanup(): Promise<void>;
}

export interface FakeTarget extends AcceptanceTarget {
  readonly fake: FakeIdentityProvider;
}

/** The fake provider on the scenario's clock: `fake:<subject>;sid=...` tokens, Clerk test emails, nothing to clean. */
export function fakeTarget(clock: TestClock): FakeTarget {
  const fake = new FakeIdentityProvider({ clock });
  const email = (label: string) => `${label}+clerk_test@example.com`;
  async function signUp(label: string, displayName: string): Promise<SignedIn> {
    const subject = newSubject(label);
    fake.createUser({ subject, email: email(label), displayName });
    const token = `fake:${subject};sid=sess_${subject}_browser`;
    return { subject, email: email(label), token: async () => token };
  }
  return {
    fake,
    provider: fake,
    webOrigin: testConfig.MWC_WEB_ORIGIN,
    email,
    companyName: (name) => name,
    signUp,
    async acceptBySignUp(invitation, label, displayName) {
      const person = await signUp(label, displayName);
      fake.accept(invitation.externalId, person.subject);
      return person;
    },
    cleanup: async () => {},
  };
}
