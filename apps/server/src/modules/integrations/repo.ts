import {
  type AuditEntry,
  accessProfiles,
  agents,
  auditChanges,
  credentials,
  ownedIn,
  ownersOf,
  PROFILE_TOOL_COLUMNS,
  type TenantDb,
} from '@mwc/db';
import { type RightsOf, storedRights, toolAccountOf } from '@mwc/shared/credentials';
import type { ToolProvider } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';

/**
 * The integrations module's reads (S7.1c, GitHub's part since S7.1d): a profile's Atlassian or GitHub part (personal
 * rows, read through the personal layer on the tenant's connection: whose the profile is with `ownersOf`, then its row
 * and its sign-in's account through its owner's layer with `ownedIn`), an agent by its principal, through the tenant,
 * and the audit rows of what a tool changed outside.
 */

/** A profile's tool part: whose, its sign-in (or none), its rights, and who the sign-in acts as (and where). */
export interface ToolPart<P extends ToolProvider> {
  readonly ownerUserId: string;
  readonly credentialId: string | null;
  readonly rights: RightsOf<P>;
  readonly site: string | null;
  readonly account: string | null;
}

export type AtlassianPart = ToolPart<'atlassian'>;
export type GitHubPart = ToolPart<'github'>;

/** The profile's part of `provider`, or undefined when the profile is gone or has none. */
async function toolPart<P extends ToolProvider>(
  t: TenantDb,
  profileId: string,
  provider: P,
): Promise<ToolPart<P> | undefined> {
  const owner = (await ownersOf(t, accessProfiles, [profileId])).get(profileId);
  if (owner === undefined) return undefined;
  const o = ownedIn(t, owner);
  const [profile] = await o.select(accessProfiles, eq(accessProfiles.id, profileId));
  const columns = PROFILE_TOOL_COLUMNS[provider];
  if (profile === undefined || profile[columns.rights] == null) return undefined;
  const rights = storedRights(provider, profile[columns.rights]);
  const credentialId = profile[columns.credential];
  const [sign] = credentialId === null ? [] : await o.select(credentials, eq(credentials.id, credentialId));
  const where = sign
    ? toolAccountOf(sign.kind, sign.accountEmail, sign.accountMeta)
    : { account: null, site: null };
  return { ownerUserId: owner, credentialId, rights, ...where };
}

/** The profile's Atlassian part, or undefined. */
const atlassianPart = (t: TenantDb, profileId: string) => toolPart(t, profileId, 'atlassian');

/** The profile's GitHub part, or undefined. */
const githubPart = (t: TenantDb, profileId: string) => toolPart(t, profileId, 'github');

/** The agent of a principal, or undefined. */
async function agentOf(t: TenantDb, principalId: string) {
  const [row] = await t.select(agents, eq(agents.principalId, principalId));
  return row;
}

/** The audit rows of a change, in the tenant's company. */
async function audit(t: TenantDb, entry: AuditEntry): Promise<void> {
  await auditChanges(t, entry);
}

export const integrationsRepo = { atlassianPart, githubPart, agentOf, audit };
export type IntegrationsRepo = typeof integrationsRepo;
