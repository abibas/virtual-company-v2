/**
 * The steps of the S1 acceptance scenario over HTTP, shared by the fake run (every lane) and the real-Clerk run (on
 * request): a person signs in and founds a company, invites someone, finds them active once they accepted, keeps them
 * out of admin routes, promotes them, lets them make an API key, and removes them. Each step asserts what Ihor would
 * see, through the API and at the identity provider, and returns what the later steps need.
 */
import type { IdentityProvider } from '@mwc/identity-core';
import { type ExternalInvitation, IDENTITY_METADATA } from '@mwc/shared/identity';
import { expect } from 'vitest';
import type { CompanyView } from '../../../src/modules/companies/schemas.ts';
import type { InvitationView, MemberView } from '../../../src/modules/members/schemas.ts';
import type { SignedIn } from './target.ts';
import type { AcceptanceWorld } from './world.ts';

/** A company with its owner, as step 1 leaves it: active, with its organization at the provider. */
export interface Founded {
  readonly owner: SignedIn;
  readonly company: CompanyView;
  readonly orgId: string;
  readonly ownerPrincipalId: string;
  /** `/api/companies/:companyId` plus `rest`. */
  path(rest?: string): string;
}

/** The invitation step 2 sends: ours, and the copy the provider sent. */
export interface Invited {
  readonly invitation: InvitationView;
  readonly sent: ExternalInvitation;
}

/** The provider role of `subject` in the organization, or undefined when they are not a member there. */
export async function providerRoleOf(provider: IdentityProvider, orgId: string, subject: string) {
  for await (const member of provider.listOrganizationMembers(orgId)) {
    if (member.subject === subject) return member.providerRole;
  }
  return undefined;
}

/** The company's members as its owner sees them. */
export async function membersOf(w: AcceptanceWorld, home: Founded): Promise<MemberView[]> {
  const res = await w.as(home.owner)('GET', home.path('/members'));
  expect(res.status).toBe(200);
  return (res.body as { members: MemberView[] }).members;
}

/**
 * Step 1: `label` signs up and signs in; `GET /api/me` links them with no companies yet; `POST /api/companies` makes
 * the company `provisioning`; one jobs tick makes its organization at the provider (found by our metadata) and turns
 * it `active`.
 */
export async function foundCompany(
  w: AcceptanceWorld,
  label: string,
  displayName: string,
  name: string,
): Promise<Founded> {
  const owner = await w.target.signUp(label, displayName);
  expect(await w.as(owner)('GET', '/api/me')).toMatchObject({
    status: 200,
    body: { user: { email: owner.email }, memberships: [], session: { via: 'clerk', pending: false } },
  });
  const created = await w.as(owner, `${label}-creates-company`)('POST', '/api/companies', {
    name: w.target.companyName(name),
  });
  expect(created).toMatchObject({ status: 201, body: { status: 'provisioning', identityOrgId: null } });
  const company = created.body as CompanyView;
  const path = (rest = '') => `/api/companies/${company.id}${rest}`;
  expect(await w.tick()).toMatchObject({ idle: false, failed: [] });
  const active = await w.as(owner)('GET', path());
  expect(active).toMatchObject({ status: 200, body: { status: 'active' } });
  const orgId = (active.body as CompanyView).identityOrgId as string;
  const org = await w.target.provider.findOrganizationByMetadata(IDENTITY_METADATA.companyId, company.id);
  expect(org?.externalId).toBe(orgId);
  expect(await w.as(owner)('GET', '/api/me')).toMatchObject({
    body: { memberships: [{ companyId: company.id, role: 'owner', status: 'active', identityOrgId: orgId }] },
  });
  const founded = { owner, company, orgId, ownerPrincipalId: '', path };
  const [me] = await membersOf(w, founded);
  expect(me).toMatchObject({ email: owner.email, role: 'owner', status: 'active' });
  return { ...founded, ownerPrincipalId: (me as MemberView).principalId };
}

/**
 * Step 2: the owner invites `label`'s email as a member; a jobs tick sends the invitation at the provider with our
 * metadata (`mwc_invitation_id`, `mwc_company_id`) and the member role, and our list shows it sent.
 */
export async function inviteMember(w: AcceptanceWorld, home: Founded, label: string): Promise<Invited> {
  const email = w.target.email(label);
  const res = await w.as(home.owner, 'owner-invites')('POST', home.path('/invitations'), {
    email,
    role: 'member',
  });
  expect(res).toMatchObject({ status: 201, body: { email, role: 'member', status: 'pending', sent: false } });
  const invitation = res.body as InvitationView;
  expect(await w.tick()).toMatchObject({ failed: [] });
  const { provider } = w.target;
  const sent = (await provider.listInvitations(home.orgId, 'pending')).find((one) => one.email === email);
  expect(sent).toMatchObject({
    providerRole: provider.roles.toProvider('member'),
    metadata: {
      [IDENTITY_METADATA.invitationId]: invitation.id,
      [IDENTITY_METADATA.companyId]: home.company.id,
    },
  });
  const listed = await w.as(home.owner)('GET', home.path('/invitations'));
  expect(listed.body).toMatchObject({ invitations: [{ id: invitation.id, sent: true }] });
  return { invitation, sent: sent as ExternalInvitation };
}

/**
 * After step 3, by any path: the owner sees `person` active as a member, the invitation is accepted by them, and the
 * person's own `GET /api/me` lists the company. Returns their member entry.
 */
export async function expectActiveMember(
  w: AcceptanceWorld,
  home: Founded,
  invited: Invited,
  person: SignedIn,
): Promise<MemberView> {
  const member = (await membersOf(w, home)).find((one) => one.email === person.email);
  expect(member).toMatchObject({ role: 'member', status: 'active' });
  const accepted = await w.as(home.owner)('GET', home.path('/invitations?status=accepted'));
  expect(accepted.body).toMatchObject({
    invitations: [{ id: invited.invitation.id, status: 'accepted', acceptedByUserId: member?.userId }],
  });
  expect(await w.as(person)('GET', '/api/me')).toMatchObject({
    status: 200,
    body: {
      user: { id: member?.userId },
      memberships: [{ companyId: home.company.id, role: 'member', status: 'active' }],
    },
  });
  return member as MemberView;
}

/** The person's role at the provider is the provider's role for `role`. */
async function expectProviderRole(
  w: AcceptanceWorld,
  home: Founded,
  person: SignedIn,
  role: 'admin' | 'member',
) {
  const { provider } = w.target;
  expect(await providerRoleOf(provider, home.orgId, person.subject)).toBe(provider.roles.toProvider(role));
}

/** Step 4: a member reads the company and its members, and is refused the admin routes (403). */
export async function expectNoAdminRights(
  w: AcceptanceWorld,
  home: Founded,
  member: SignedIn,
): Promise<void> {
  const as = w.as(member);
  expect((await as('GET', home.path())).status).toBe(200);
  expect((await as('GET', home.path('/members'))).status).toBe(200);
  const refused = { status: 403, body: { error: { code: 'forbidden' } } };
  const invite = { email: w.target.email('refused'), role: 'member' };
  expect(await as('POST', home.path('/invitations'), invite)).toMatchObject(refused);
  expect(await as('PATCH', home.path(), { name: 'Taken Over' })).toMatchObject(refused);
  expect(await as('POST', home.path('/sync'))).toMatchObject(refused);
  expect(await as('GET', home.path('/invitations'))).toMatchObject(refused);
}

/**
 * Step 5: the owner makes the member an admin; a jobs tick pushes the role to the provider (outbox `update_role`); the
 * new admin can now invite (201).
 */
export async function promoteToAdmin(
  w: AcceptanceWorld,
  home: Founded,
  member: MemberView,
  person: SignedIn,
): Promise<void> {
  const res = await w.as(home.owner, 'owner-promotes')('PATCH', home.path(`/members/${member.id}`), {
    role: 'admin',
  });
  expect(res).toMatchObject({ status: 200, body: { id: member.id, role: 'admin', status: 'active' } });
  await expectProviderRole(w, home, person, 'member');
  expect(await w.tick()).toMatchObject({ failed: [] });
  await expectProviderRole(w, home, person, 'admin');
  const email = w.target.email('third');
  const invited = await w.as(person, 'admin-invites')('POST', home.path('/invitations'), {
    email,
    role: 'member',
  });
  expect(invited).toMatchObject({ status: 201, body: { email, invitedByPrincipalId: member.principalId } });
}

/**
 * Step 6: the person makes a personal API key (shown once); `GET /api/me` with it is what `mwc whoami` asks: the
 * person, this company only, as an admin, by API key.
 */
export async function makeApiKey(w: AcceptanceWorld, home: Founded, person: SignedIn): Promise<string> {
  const res = await w.as(person, 'admin-creates-key')('POST', home.path('/api-keys'), { name: 'laptop' });
  expect(res).toMatchObject({ status: 201, body: { name: 'laptop', kind: 'personal' } });
  const key = (res.body as { secret: string }).secret;
  expect(await w.as(key)('GET', '/api/me')).toMatchObject({
    status: 200,
    body: {
      user: { email: person.email },
      memberships: [{ companyId: home.company.id, role: 'admin', status: 'active' }],
      session: { via: 'api_key', pending: false },
    },
  });
  expect((await w.as(key)('GET', home.path())).status).toBe(200);
  return key;
}

/**
 * Step 7: the owner removes the member. At once their session gets 404 on the company (and `GET /api/me` lists it no
 * more) and their API key 401; the provider still has them until the next jobs tick runs the outbox `remove_member`.
 */
export async function removeMember(
  w: AcceptanceWorld,
  home: Founded,
  member: MemberView,
  person: SignedIn,
  key?: string,
): Promise<void> {
  const res = await w.as(home.owner, 'owner-removes')('DELETE', home.path(`/members/${member.id}`));
  expect(res.status).toBe(204);
  expect(await w.as(person)('GET', home.path())).toMatchObject({
    status: 404,
    body: { error: { code: 'not_found' } },
  });
  expect(await w.as(person)('GET', '/api/me')).toMatchObject({ status: 200, body: { memberships: [] } });
  if (key !== undefined) {
    expect(await w.as(key)('GET', '/api/me')).toMatchObject({ status: 401 });
    expect(await w.as(key)('GET', home.path())).toMatchObject({ status: 401 });
  }
  expect((await membersOf(w, home)).map((one) => one.email)).not.toContain(person.email);
  const { provider } = w.target;
  expect(await providerRoleOf(provider, home.orgId, person.subject)).toBeDefined();
  expect(await w.tick()).toMatchObject({ failed: [] });
  expect(await providerRoleOf(provider, home.orgId, person.subject)).toBeUndefined();
}
