import { describe, expect, it } from 'vitest';
import { FakeIdentityProvider } from '../../src/fake.ts';
import { collect, populated, providerError } from '../fixtures/provider.ts';

// FakeIdentityProvider's organizations (src/fake/organizations.ts), through the provider.
describe('FakeIdentityProvider: organizations', () => {
  it('creates an organization with its creator as an admin member', async () => {
    const { fake, org } = await populated();
    expect(org).toEqual({
      externalId: expect.stringMatching(/^org_\d+$/),
      name: 'Acme',
      metadata: { mwc_company_id: 'c1' },
      updatedAt: expect.any(Number),
    });
    const members = await collect(fake.listOrganizationMembers(org.externalId));
    expect(members).toMatchObject([
      { orgExternalId: org.externalId, subject: 'u1', providerRole: 'org:admin', metadata: {} },
    ]);
    expect(await fake.listUserOrganizations('u1')).toEqual([{ org, membership: members[0] }]);
    expect(await fake.listUserOrganizations('u2')).toEqual([]);
    const bare = await fake.createOrganization({ name: 'Bare', metadata: {} });
    expect(await collect(fake.listOrganizationMembers(bare.externalId))).toEqual([]);
  });

  it('ignores a slug by default, as the Clerk connector does, and keeps it with organizationSlugs', async () => {
    const { fake } = await populated();
    expect(fake.capabilities.organizationSlugs).toBe(false);
    const twice = [1, 2].map(() => fake.createOrganization({ name: 'S', slug: 'same', metadata: {} }));
    expect((await Promise.all(twice)).map((org) => org.slug)).toEqual([undefined, undefined]);
    const slugs = new FakeIdentityProvider({ organizationSlugs: true });
    expect(slugs.capabilities.organizationSlugs).toBe(true);
    expect(await slugs.createOrganization({ name: 'A', slug: 'acme', metadata: {} })).toMatchObject({
      slug: 'acme',
    });
    expect((await slugs.createOrganization({ name: 'Bare', metadata: {} })).slug).toBeUndefined();
  });

  it('refuses a taken slug (with organizationSlugs) and an unknown creator', async () => {
    const { fake } = await populated();
    const slugs = new FakeIdentityProvider({ organizationSlugs: true });
    await slugs.createOrganization({ name: 'A', slug: 'acme', metadata: {} });
    expect(
      (await providerError(() => slugs.createOrganization({ name: 'B', slug: 'acme', metadata: {} }))).code,
    ).toBe('conflict');
    const unknownCreator = () =>
      fake.createOrganization({ name: 'B', metadata: {}, createdBySubject: 'u404' });
    expect((await providerError(unknownCreator)).code).toBe('not_found');
  });

  it('finds an organization by its metadata', async () => {
    const { fake, org } = await populated();
    expect(await fake.findOrganizationByMetadata('mwc_company_id', 'c1')).toEqual(org);
    expect(await fake.findOrganizationByMetadata('mwc_company_id', 'c2')).toBeNull();
  });

  it('deletes an organization with its members and invitations, idempotently', async () => {
    const { fake, org } = await populated();
    await fake.deleteOrganization(org.externalId);
    await fake.deleteOrganization(org.externalId);
    expect(fake.drainEvents()).toMatchObject([{ type: 'org.deleted', data: { externalId: org.externalId } }]);
    expect(await fake.findOrganizationByMetadata('mwc_company_id', 'c1')).toBeNull();
    expect((await providerError(() => fake.listInvitations(org.externalId))).code).toBe('not_found');
    expect(await fake.listUserOrganizations('u1')).toEqual([]);
  });

  it('lists members as an AsyncIterable that rejects on iteration for an unknown organization', async () => {
    const { fake } = await populated();
    const listing = fake.listOrganizationMembers('org_404');
    expect(typeof listing[Symbol.asyncIterator]).toBe('function');
    expect((await providerError(() => collect(listing))).code).toBe('not_found');
  });
});
