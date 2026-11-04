import { createHash } from 'node:crypto';
import { IDENTITY_METADATA, type MembershipRole, type NormalizedIdentityEvent } from '@mwc/shared/identity';
import { FakeIdentityProvider } from '../fake.ts';
import { type ProjectionChange, type ProjectionContext, project, projectionContext } from '../projector.ts';
import type { IdentityStore } from '../store.ts';

/** 2026-11-03T12:00:00Z: the fake's clock stands here, so its times are T0, T0+1, T0+2, ... */
export const T0 = Date.UTC(2026, 10, 3, 12);

/** A fake provider on a standing clock, and the projection context for it. */
export function fakeWorld(): { fake: FakeIdentityProvider; ctx: ProjectionContext } {
  const fake = new FakeIdentityProvider({ clock: () => new Date(T0) });
  return { fake, ctx: projectionContext(fake) };
}

/** Projects the events in order; returns every change. */
export async function applyAll(
  events: readonly NormalizedIdentityEvent[],
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const changes: ProjectionChange[] = [];
  for (const event of events) changes.push(...(await project(event, store, ctx)));
  return changes;
}

/** Metadata the outbox puts on a provider invitation (S1.7). */
export function invitationMetadata(invitationId: string, companyId: string) {
  return { [IDENTITY_METADATA.invitationId]: invitationId, [IDENTITY_METADATA.companyId]: companyId };
}

/**
 * The same UUID for the same name on every run (shaped like a v7), so a scenario built twice links to the
 * same companies and invitations, and a database store accepts its ids.
 */
export function scenarioId(name: string): string {
  const hex = createHash('sha256').update(`mwc-scenario:${name}`).digest('hex');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Where a scenario puts the local state it starts from: what company creation (S1.5) and invitations (S1.7)
 * make. `InMemoryIdentityStore` is one; the store contract's targets are others (`@mwc/testkit`).
 */
export interface IdentitySeeder {
  addCompany(input: { id: string; identityOrgExternalId: string | null }): unknown;
  addUser(input: {
    issuer: string;
    subject: string;
    primaryEmail: string;
    displayName: string;
  }): { readonly id: string } | Promise<{ readonly id: string }>;
  addMembership(input: { companyId: string; userId: string; role: MembershipRole }): unknown;
  addInvitation(input: {
    id: string;
    companyId: string;
    email: string;
    role: MembershipRole;
    externalInvitationId: string | null;
  }): unknown;
}
