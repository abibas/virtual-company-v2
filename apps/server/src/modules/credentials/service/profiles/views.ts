import { type AccessProfile, type DbHandle, type OwnedDb, tenant } from '@mwc/db';
import { isToolProvider, storedRights, toolAccountOf } from '@mwc/shared/credentials';
import { companiesOf } from '../../../identity/service.ts';
import { agentsUsingProfiles } from '../../../org/service.ts';
import { profileRows as repo } from '../../repo/profiles.ts';
import type { AccessProfileView, ProfileAgentView, ProfileSubscriptionView } from '../../schemas/profiles.ts';

// What the access profiles API shows of a person's profiles (S3.4): each with its credentials as metadata and the
// agents using it in the owner's companies. Read outside the writes' transactions.

/** The companies a person belongs to (not removed, not deleted), as `GET /api/me` lists them. */
export const companiesOfUser = (db: DbHandle, userId: string) =>
  companiesOf(db, { kind: 'user', via: 'clerk', userId });

/**
 * The agents that use each of these profiles, in the owner's companies (an agent with one of their profiles is in a
 * company they belong to: leaving one takes their profiles off its agents), by profile id.
 */
export async function agentsByProfile(db: DbHandle, userId: string, profileIds: readonly string[]) {
  const uses = new Map<string, ProfileAgentView[]>();
  if (profileIds.length === 0) return uses;
  for (const company of await companiesOfUser(db, userId)) {
    for (const use of await agentsUsingProfiles(await tenant(db, company.companyId), profileIds)) {
      const agent = {
        companyId: company.companyId,
        companySlug: company.slug,
        companyName: company.name,
        agentId: use.agentId,
        agentName: use.name,
        agentSlug: use.slug,
      };
      uses.set(use.profileId, [...(uses.get(use.profileId) ?? []), agent]);
    }
  }
  return uses;
}

/**
 * Profiles as the API shows them: their credentials as metadata (never a secret; a tool sign-in also with the account
 * and site it acts as), a tool profile's rights (`storedRights`) and the agents using each.
 */
export async function views(
  o: OwnedDb,
  rows: readonly AccessProfile[],
  uses: ReadonlyMap<string, ProfileAgentView[]>,
): Promise<AccessProfileView[]> {
  const ids = rows.flatMap((row) => [row.credentialId, row.gatewayCredentialId]).filter((id) => id !== null);
  const held = new Map<string, ProfileSubscriptionView>();
  for (const credential of await repo.credentialsOf(o, ids)) {
    const { id, kind, label, accountEmail, status } = credential;
    held.set(id, {
      id,
      kind,
      label,
      accountEmail,
      status,
      ...toolAccountOf(kind, accountEmail, credential.accountMeta),
    });
  }
  const shownAs = (id: string | null) => (id === null ? null : (held.get(id) ?? null));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    subscription: shownAs(row.credentialId),
    gateway: shownAs(row.gatewayCredentialId),
    model: row.model,
    effort: row.effort,
    rights: isToolProvider(row.provider) ? storedRights(row.provider, row.rights) : null,
    agents: uses.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
