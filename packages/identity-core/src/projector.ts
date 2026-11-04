import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import {
  change,
  type Event,
  type ProjectionChange,
  type ProjectionContext,
  type Replay,
} from './projector/changes.ts';
import { projectInvitation } from './projector/invitations.ts';
import { projectMembershipDeleted, projectMembershipUpserted } from './projector/memberships.ts';
import { projectUserDeleted, projectUserUpserted } from './projector/users.ts';
import type { IdentityProvider } from './provider.ts';
import { type IdentityStore, identityKeys } from './store.ts';

/**
 * The projector: the single, idempotent place where external identity state becomes local state. Every
 * path (webhook, reconcile-on-sign-in, periodic reconcile, manual sync) hands it normalized events.
 *
 * It is order-safe: the same set of events, applied in any order and any number of times, leaves the
 * same state. That rests on four rules (README.md has the full list):
 * - fields follow the newest provider state by `updatedAt` (a mark per entity); older upserts are ignored;
 * - deletions are sticky flags (a deleted user stays deactivated, a deleted provider membership never
 *   makes a row active) and never move the mark, so fields still follow the newest upsert;
 * - an event whose user or company is not known yet is parked and replayed when it is;
 * - a membership is linked to a local invitation by `mwc_invitation_id`, else by the provider's
 *   invitation id, never by email, and takes its role from that invitation;
 * - a refused event (an unlinked membership, an invitation of another company) changes nothing at all,
 *   so it commutes with every other event.
 * Deduplicating deliveries by `externalEventId` is the caller's job (S1.3); applying one twice is a no-op.
 *
 * This file dispatches; the handlers live in projector/ (users, memberships with the invitation link,
 * invitations) and the shapes they report in projector/changes.ts.
 */

export type {
  FieldChange,
  ProjectionAction,
  ProjectionChange,
  ProjectionContext,
} from './projector/changes.ts';
export { effectiveRole } from './projector/memberships.ts';

export function projectionContext(provider: Pick<IdentityProvider, 'issuer' | 'roles'>): ProjectionContext {
  return { issuer: provider.issuer, roles: provider.roles };
}

/** Applies one normalized event to the store; returns what changed (and what was ignored and why). */
export async function project(
  event: NormalizedIdentityEvent,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const replay: Replay = (key) => replayDeferred(key, store, ctx);
  switch (event.type) {
    case 'user.upserted':
      return projectUserUpserted(event, store, ctx, replay);
    case 'user.deleted':
      return projectUserDeleted(event, store, ctx);
    case 'org.upserted':
      return projectOrgUpserted(event, store, replay);
    case 'org.deleted': {
      // Companies are local-first: the provider deleting the organization changes nothing here. S1.5
      // decides what to do (and a local company delete removes the organization, not the other way).
      const company = await store.getCompanyByOrgExternalId(event.data.externalId);
      return [
        change(event, 'company', 'ignored', { id: company?.id ?? null, reason: 'org_deleted_upstream' }),
      ];
    }
    case 'membership.upserted':
      return projectMembershipUpserted(event, store, ctx);
    case 'membership.deleted':
      return projectMembershipDeleted(event, store, ctx);
    case 'invitation.accepted':
    case 'invitation.revoked':
      return projectInvitation(event, store);
  }
}

/** Replays the events parked under a key (`identityKeys.user(...)` or `identityKeys.org(...)`). */
export async function replayDeferred(
  key: string,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const changes: ProjectionChange[] = [];
  for (const parked of await store.takeDeferred(key)) changes.push(...(await project(parked, store, ctx)));
  return changes;
}

async function projectOrgUpserted(
  event: Event<'org.upserted'>,
  store: IdentityStore,
  replay: Replay,
): Promise<ProjectionChange[]> {
  const company = await store.getCompanyByOrgExternalId(event.data.externalId);
  if (!company) return [change(event, 'company', 'ignored', { reason: 'unknown_company' })];
  // The company's own fields are local; the organization showing up is the moment its parked events can run.
  const replayed = await replay(identityKeys.org(event.data.externalId));
  return replayed.length > 0
    ? replayed
    : [change(event, 'company', 'ignored', { id: company.id, reason: 'company_is_local' })];
}
