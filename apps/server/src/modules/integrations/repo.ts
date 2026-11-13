import {
  type AuditEntry,
  accessProfiles,
  agents,
  auditChanges,
  credentials,
  ownedIn,
  ownersOf,
  type TenantDb,
} from '@mwc/db';
import { type AtlassianRights, storedRights, toolAccountOf } from '@mwc/shared/credentials';
import { eq } from 'drizzle-orm';

/**
 * The integrations module's reads (S7.1c): a profile's Atlassian part (personal rows, read through the personal layer
 * on the tenant's connection: whose the profile is with `ownersOf`, then its row and its sign-in's account through its
 * owner's layer with `ownedIn`), an agent by its principal, through the tenant, and the audit rows of what a tool
 * changed in Atlassian.
 */

/** A profile's Atlassian part: whose, its sign-in (or none), its rights, and who the sign-in acts as where. */
export interface AtlassianPart {
  readonly ownerUserId: string;
  readonly credentialId: string | null;
  readonly rights: AtlassianRights;
  readonly site: string | null;
  readonly account: string | null;
}

/** The profile's Atlassian part, or undefined when the profile is gone or has none. */
async function atlassianPart(t: TenantDb, profileId: string): Promise<AtlassianPart | undefined> {
  const owner = (await ownersOf(t, accessProfiles, [profileId])).get(profileId);
  if (owner === undefined) return undefined;
  const o = ownedIn(t, owner);
  const [profile] = await o.select(accessProfiles, eq(accessProfiles.id, profileId));
  if (profile?.atlassianRights == null) return undefined;
  const rights = storedRights('atlassian', profile.atlassianRights);
  const credentialId = profile.atlassianCredentialId;
  const [sign] = credentialId === null ? [] : await o.select(credentials, eq(credentials.id, credentialId));
  const where = sign
    ? toolAccountOf(sign.kind, sign.accountEmail, sign.accountMeta)
    : { account: null, site: null };
  return { ownerUserId: owner, credentialId, rights, ...where };
}

/** The agent of a principal, or undefined. */
async function agentOf(t: TenantDb, principalId: string) {
  const [row] = await t.select(agents, eq(agents.principalId, principalId));
  return row;
}

/** The audit rows of a change, in the tenant's company. */
async function audit(t: TenantDb, entry: AuditEntry): Promise<void> {
  await auditChanges(t, entry);
}

export const integrationsRepo = { atlassianPart, agentOf, audit };
export type IntegrationsRepo = typeof integrationsRepo;
