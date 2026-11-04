import { type IdentityProvider, IdentityProviderError, type WebhookRequest } from '@mwc/identity-core';
import type { ExternalInvitation, ExternalOrg, ExternalUser } from '@mwc/shared/identity';

/** The authorized party the contract's tokens are verified for: the web dev origin. */
export const CONTRACT_WEB_ORIGIN = 'http://localhost:9951';

/** What the invitee's acceptance gave: the new member, or why this target could not accept. */
export type AcceptResult = { readonly subject: string } | { readonly unverified: string };

/**
 * One provider under the contract, with the actions the port does not have (people signing up, tokens,
 * accepting an invitation, signed webhooks) and the cleanup. Every name, slug and email a target creates
 * starts with `runId`, so a run's objects can be found and removed.
 */
export interface ContractTarget {
  readonly provider: IdentityProvider;
  /** `mwc-contract-<random>`: unique to this run. */
  readonly runId: string;
  /** An email the provider accepts without sending real mail (Clerk: `...+clerk_test@example.com`). */
  email(label: string): string;
  /** A person signs up (the provider's dashboard or API, not the port). */
  createUser(label: string, displayName: string): Promise<ExternalUser>;
  /** A session token for the person, and the authorized parties to verify it with. */
  mintToken(subject: string): Promise<{ token: string; authorizedParties: string[] }>;
  /** Well-formed ids of things that do not exist at the provider. */
  readonly missing: { readonly subject: string; readonly org: string; readonly invitation: string };
  /** The invitee accepts the invitation (signs up through it). */
  acceptInvitation(invitation: ExternalInvitation): Promise<AcceptResult>;
  /** A delivery signed the way the provider signs webhooks, saying that `subject` was deleted. */
  signedUserDeleted(subject: string): WebhookRequest;
  /** Removes everything this run created; runs after the cases, even when one failed. */
  cleanup(): Promise<void>;
}

/** What the cases share, in order: each case reads what the earlier ones made. */
export interface ContractState {
  target: ContractTarget;
  provider: IdentityProvider;
  owner?: ExternalUser;
  companyId?: string;
  org?: ExternalOrg;
  invitation?: ExternalInvitation;
  member?: string;
}

export interface ContractCase {
  readonly name: string;
  /** `skip(note)` ends the case as skipped with the reason (a step this target cannot take). */
  run(state: ContractState, skip: (note: string) => never): Promise<void>;
}

/** The value an earlier case left, or a clear failure when that case did not get that far. */
export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`contract: no ${what} (an earlier case failed)`);
  return value;
}

/** The provider error a call rejected with; fails when it resolved or threw something else. */
export async function providerError(call: () => Promise<unknown>): Promise<IdentityProviderError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof IdentityProviderError) return error;
    throw error;
  }
  throw new Error('contract: expected an IdentityProviderError');
}

export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}
