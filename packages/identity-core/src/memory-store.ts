import type { CompanyStatus, UserStatus } from '@mwc/shared/enums';
import type {
  InvitationStatus,
  MembershipRole,
  MembershipStatus,
  NormalizedIdentityEvent,
} from '@mwc/shared/identity';
import { newId } from '@mwc/shared/ids';
import type {
  IdentityMark,
  IdentityStore,
  InvitationPatch,
  NewStoredMembership,
  NewStoredUser,
  StoredCompany,
  StoredInvitation,
  StoredMembership,
  StoredUser,
} from './store.ts';

/**
 * `IdentityStore` in memory, for tests: the projector's behaviour without a database. `add*` seed the
 * local state the projector reads (companies, invitations, locally created memberships), and
 * `snapshot()` gives the state with ids replaced by natural keys, so stores built in different orders
 * compare equal when they hold the same thing.
 */
export class InMemoryIdentityStore implements IdentityStore {
  readonly #users = new Map<string, StoredUser>();
  readonly #companies = new Map<string, StoredCompany>();
  readonly #memberships = new Map<string, StoredMembership>();
  readonly #invitations = new Map<string, StoredInvitation>();
  readonly #marks = new Map<string, IdentityMark>();
  readonly #deferred = new Map<string, NormalizedIdentityEvent[]>();

  addCompany(input: {
    id?: string;
    identityOrgExternalId: string | null;
    status?: CompanyStatus;
  }): StoredCompany {
    const company: StoredCompany = {
      id: input.id ?? newId(),
      identityOrgExternalId: input.identityOrgExternalId,
      status: input.status ?? 'active',
    };
    this.#companies.set(company.id, company);
    return company;
  }

  /** Links a company to its provider organization, as the outbox does once the provider created it. */
  linkCompany(companyId: string, orgExternalId: string): StoredCompany {
    const company = this.#companies.get(companyId);
    if (!company) throw new Error(`no company ${companyId}`);
    const linked = { ...company, identityOrgExternalId: orgExternalId };
    this.#companies.set(companyId, linked);
    return linked;
  }

  addUser(
    input: Omit<NewStoredUser, 'status' | 'imageUrl'> & {
      id?: string;
      status?: UserStatus;
      imageUrl?: string | null;
    },
  ): StoredUser {
    const user: StoredUser = {
      id: input.id ?? newId(),
      issuer: input.issuer,
      subject: input.subject,
      primaryEmail: input.primaryEmail.toLowerCase(),
      displayName: input.displayName,
      imageUrl: input.imageUrl ?? null,
      status: input.status ?? 'active',
    };
    this.#users.set(user.id, user);
    return user;
  }

  addMembership(input: {
    companyId: string;
    userId: string;
    role: MembershipRole;
    status?: MembershipStatus;
    externalMembershipId?: string | null;
    providerRole?: string | null;
    invitationId?: string | null;
  }): StoredMembership {
    return this.#putMembership({
      companyId: input.companyId,
      userId: input.userId,
      role: input.role,
      grantedRole: input.role,
      status: input.status ?? 'active',
      externalMembershipId: input.externalMembershipId ?? null,
      providerRole: input.providerRole ?? null,
      invitationId: input.invitationId ?? null,
    });
  }

  addInvitation(input: {
    id?: string;
    companyId: string;
    email: string;
    role: MembershipRole;
    status?: InvitationStatus;
    externalInvitationId?: string | null;
  }): StoredInvitation {
    const invitation: StoredInvitation = {
      id: input.id ?? newId(),
      companyId: input.companyId,
      email: input.email.toLowerCase(),
      role: input.role,
      status: input.status ?? 'pending',
      externalInvitationId: input.externalInvitationId ?? null,
      acceptedByUserId: null,
    };
    this.#invitations.set(invitation.id, invitation);
    return invitation;
  }

  async getUser(issuer: string, subject: string): Promise<StoredUser | undefined> {
    return this.#findUser(issuer, subject);
  }

  async getUserById(id: string): Promise<StoredUser | undefined> {
    return this.#users.get(id);
  }

  async upsertUser(user: NewStoredUser): Promise<StoredUser> {
    const saved = { ...user, id: this.#findUser(user.issuer, user.subject)?.id ?? newId() };
    this.#users.set(saved.id, saved);
    return saved;
  }

  async getCompany(id: string): Promise<StoredCompany | undefined> {
    return this.#companies.get(id);
  }

  async getCompanyByOrgExternalId(orgExternalId: string): Promise<StoredCompany | undefined> {
    return [...this.#companies.values()].find((company) => company.identityOrgExternalId === orgExternalId);
  }

  async getMembership(companyId: string, userId: string): Promise<StoredMembership | undefined> {
    return this.#findMembership(companyId, userId);
  }

  async listMemberships(
    filter: { readonly companyId: string } | { readonly userId: string },
  ): Promise<StoredMembership[]> {
    return [...this.#memberships.values()].filter((m) =>
      'companyId' in filter ? m.companyId === filter.companyId : m.userId === filter.userId,
    );
  }

  async upsertMembership(membership: NewStoredMembership): Promise<StoredMembership> {
    return this.#putMembership(membership);
  }

  async getInvitation(id: string): Promise<StoredInvitation | undefined> {
    return this.#invitations.get(id);
  }

  async getInvitationByExternalId(externalInvitationId: string): Promise<StoredInvitation | undefined> {
    return [...this.#invitations.values()].find((i) => i.externalInvitationId === externalInvitationId);
  }

  async updateInvitation(id: string, patch: InvitationPatch): Promise<StoredInvitation> {
    const invitation = this.#invitations.get(id);
    if (!invitation) throw new Error(`no invitation ${id}`);
    const saved = { ...invitation, ...patch };
    this.#invitations.set(id, saved);
    return saved;
  }

  async getMark(key: string): Promise<IdentityMark | undefined> {
    return this.#marks.get(key);
  }

  async setMark(key: string, mark: IdentityMark): Promise<void> {
    this.#marks.set(key, mark);
  }

  async defer(key: string, event: NormalizedIdentityEvent): Promise<void> {
    const parked = this.#deferred.get(key) ?? [];
    if (!parked.some((e) => e.externalEventId === event.externalEventId)) parked.push(event);
    this.#deferred.set(key, parked);
  }

  async takeDeferred(key: string): Promise<NormalizedIdentityEvent[]> {
    const parked = this.#deferred.get(key) ?? [];
    this.#deferred.delete(key);
    return parked;
  }

  /** The state with ids replaced by natural keys (users by subject), every list sorted. */
  snapshot() {
    const subjectOf = (userId: string | null) =>
      userId === null ? null : (this.#users.get(userId)?.subject ?? `?${userId}`);
    const byKey = <T>(rows: T[], key: (row: T) => string) =>
      rows.sort((a, b) => key(a).localeCompare(key(b)));
    const naturalKey = (key: string) =>
      [...this.#users.values()].reduce((k, user) => k.replaceAll(user.id, `@${user.subject}`), key);
    return {
      companies: byKey([...this.#companies.values()], (c) => c.id),
      users: byKey(
        [...this.#users.values()].map(({ id: _id, ...user }) => user),
        (u) => `${u.issuer}|${u.subject}`,
      ),
      memberships: byKey(
        [...this.#memberships.values()].map(({ id: _id, userId, ...m }) => ({
          ...m,
          user: subjectOf(userId),
        })),
        (m) => `${m.companyId}|${m.user}`,
      ),
      invitations: byKey(
        [...this.#invitations.values()].map(({ acceptedByUserId, ...i }) => ({
          ...i,
          acceptedBy: subjectOf(acceptedByUserId),
        })),
        (i) => i.id,
      ),
      marks: Object.fromEntries(
        [...this.#marks.entries()]
          .map(([key, mark]) => [naturalKey(key), mark] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      deferred: Object.fromEntries(
        [...this.#deferred.entries()]
          .filter(([, events]) => events.length > 0)
          .map(([key, events]) => [key, events.map((e) => e.externalEventId).sort()] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  #findUser(issuer: string, subject: string): StoredUser | undefined {
    return [...this.#users.values()].find((u) => u.issuer === issuer && u.subject === subject);
  }

  #findMembership(companyId: string, userId: string): StoredMembership | undefined {
    return [...this.#memberships.values()].find((m) => m.companyId === companyId && m.userId === userId);
  }

  #putMembership(membership: NewStoredMembership): StoredMembership {
    const id = this.#findMembership(membership.companyId, membership.userId)?.id ?? newId();
    const saved = { ...membership, id };
    this.#memberships.set(id, saved);
    return saved;
  }
}
