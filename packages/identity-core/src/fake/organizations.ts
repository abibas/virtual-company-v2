import type { ExternalOrg } from '@mwc/shared/identity';
import { IdentityProviderError } from '../errors.ts';
import type { CreateOrganizationInput, ProviderCapabilities } from '../provider.ts';
import type { FakeWorld } from './world.ts';

/** The fake provider's organizations, as Clerk handles them; `FakeIdentityProvider` delegates here. */

/**
 * A new organization (emitted), with its creator as its first member in `creatorRole` when the input names
 * one, as Clerk's `createdBy` does. A provider with `organizationSlugs` keeps the input's slug and refuses a taken
 * one; any other ignores it. Refuses a creator who does not exist.
 */
export function createFakeOrganization(
  world: FakeWorld,
  input: CreateOrganizationInput,
  creatorRole: string,
  { organizationSlugs }: Pick<ProviderCapabilities, 'organizationSlugs'>,
): ExternalOrg {
  const slug = organizationSlugs ? input.slug : undefined;
  if (slug !== undefined && [...world.orgs.values()].some((org) => org.slug === slug)) {
    throw new IdentityProviderError('conflict', `fake: slug ${slug} is taken`);
  }
  if (input.createdBySubject !== undefined) world.user(input.createdBySubject);
  const org: ExternalOrg = {
    externalId: world.id('org'),
    name: input.name,
    ...(slug === undefined ? {} : { slug }),
    metadata: { ...input.metadata },
    updatedAt: world.tick(),
  };
  world.orgs.set(org.externalId, org);
  world.members.set(org.externalId, new Map());
  world.emit({ type: 'org.upserted', data: org }, org.updatedAt);
  if (input.createdBySubject !== undefined) {
    world.addMembership(org.externalId, input.createdBySubject, creatorRole, { metadata: {} });
  }
  return org;
}

/** Deletes an organization with its memberships and invitations (emitted); an unknown one is a no-op. */
export function deleteFakeOrganization(world: FakeWorld, externalId: string): void {
  if (!world.orgs.delete(externalId)) return;
  world.members.delete(externalId);
  for (const [id, invitation] of world.invitations)
    if (invitation.orgExternalId === externalId) world.invitations.delete(id);
  world.emit({ type: 'org.deleted', data: { externalId } }, world.tick());
}
