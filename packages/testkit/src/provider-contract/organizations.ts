import { IDENTITY_METADATA } from '@mwc/shared/identity';
import { expect } from 'vitest';
import { type ContractCase, collect, need, providerError } from './state.ts';

/** Why the slug case does not apply to a provider that keeps no organization slugs. */
const NO_ORGANIZATION_SLUGS =
  'this provider keeps no organization slugs (capabilities.organizationSlugs is false): company slugs are ours';

export const createsOrganizations: ContractCase = {
  name: 'createOrganization keeps the company id in private metadata; findOrganizationByMetadata finds it',
  async run(state) {
    const { target, provider } = state;
    const owner = need(state.owner, 'owner');
    state.companyId = `${target.runId}-company`;
    // Always given a slug: a provider without organization slugs must ignore it (Clerk refuses any slug sent while
    // its organization slugs are off), and one with them must keep it.
    state.org = await provider.createOrganization({
      name: target.runId,
      slug: target.runId,
      metadata: { [IDENTITY_METADATA.companyId]: state.companyId },
      createdBySubject: owner.subject,
    });
    expect(state.org.name).toBe(target.runId);
    if (provider.capabilities.organizationSlugs) expect(state.org.slug).toBe(target.runId);
    expect(state.org.metadata[IDENTITY_METADATA.companyId]).toBe(state.companyId);
    const found = await provider.findOrganizationByMetadata(IDENTITY_METADATA.companyId, state.companyId);
    expect(found?.externalId).toBe(state.org.externalId);
    expect(
      await provider.findOrganizationByMetadata(IDENTITY_METADATA.companyId, `${target.runId}-none`),
    ).toBeNull();
  },
};

export const refusesTakenSlugs: ContractCase = {
  name: 'createOrganization refuses a slug that is taken as conflict (providers with organization slugs)',
  async run({ target, provider, owner }, skip) {
    if (!provider.capabilities.organizationSlugs) return skip(NO_ORGANIZATION_SLUGS);
    const error = await providerError(() =>
      provider.createOrganization({
        name: `${target.runId}-again`,
        slug: target.runId,
        metadata: {},
        createdBySubject: need(owner, 'owner').subject,
      }),
    );
    expect(error.code).toBe('conflict');
  },
};

export const listsMembers: ContractCase = {
  name: "the creator is an admin-like member, in the organization's list and in their own",
  async run({ provider, owner, org }) {
    const { subject } = need(owner, 'owner');
    const { externalId } = need(org, 'organization');
    const members = await collect(provider.listOrganizationMembers(externalId));
    expect(members.find((m) => m.subject === subject)).toMatchObject({
      orgExternalId: externalId,
      externalMembershipId: expect.any(String),
    });
    expect(members.some((m) => m.subject === subject && provider.roles.isAdmin(m.providerRole))).toBe(true);
    const mine = await provider.listUserOrganizations(subject);
    expect(mine.find((entry) => entry.org.externalId === externalId)?.membership.subject).toBe(subject);
  },
};

export const refusesUnknownOrganizations: ContractCase = {
  name: 'listOrganizationMembers rejects an unknown organization as not_found',
  async run({ target, provider }) {
    const error = await providerError(() => collect(provider.listOrganizationMembers(target.missing.org)));
    expect(error.code).toBe('not_found');
  },
};

export const updatesRoles: ContractCase = {
  name: 'updateMemberRole promotes a member, again changes nothing, and refuses a non-member as not_found',
  async run({ target, provider, org, member }, skip) {
    const { externalId } = need(org, 'organization');
    if (member === undefined) return skip('no accepted member to promote (see the acceptance case)');
    const promoted = await provider.updateMemberRole(externalId, member, 'admin');
    expect(promoted).toMatchObject({ orgExternalId: externalId, subject: member });
    expect(provider.roles.isAdmin(promoted.providerRole)).toBe(true);
    const again = await provider.updateMemberRole(externalId, member, 'owner');
    expect(again.providerRole).toBe(promoted.providerRole);
    const error = await providerError(() =>
      provider.updateMemberRole(externalId, target.missing.subject, 'member'),
    );
    expect(error.code).toBe('not_found');
  },
};

export const removesMembers: ContractCase = {
  name: 'removeMember removes a member, and removing them again resolves',
  async run({ provider, org, member }, skip) {
    const { externalId } = need(org, 'organization');
    if (member === undefined) return skip('no accepted member to remove (see the acceptance case)');
    await provider.removeMember(externalId, member);
    const members = await collect(provider.listOrganizationMembers(externalId));
    expect(members.map((m) => m.subject)).not.toContain(member);
    await expect(provider.removeMember(externalId, member)).resolves.toBeUndefined();
  },
};

export const deletesOrganizations: ContractCase = {
  name: 'deleteOrganization deletes it (lists then say not_found), and deleting it again resolves',
  async run({ provider, org, companyId }) {
    const { externalId } = need(org, 'organization');
    await provider.deleteOrganization(externalId);
    expect(
      await provider.findOrganizationByMetadata(IDENTITY_METADATA.companyId, need(companyId, 'company')),
    ).toBeNull();
    await expect(provider.deleteOrganization(externalId)).resolves.toBeUndefined();
    expect((await providerError(() => collect(provider.listOrganizationMembers(externalId)))).code).toBe(
      'not_found',
    );
    expect((await providerError(() => provider.listInvitations(externalId))).code).toBe('not_found');
  },
};
