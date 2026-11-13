import {
  type AccessProfile,
  aiPartOf,
  type DbHandle,
  type OwnedDb,
  PROFILE_AI_COLUMNS,
  PROFILE_TOOL_COLUMNS,
  tenant,
} from '@mwc/db';
import { storedRights, TOOL_PROVIDERS, toolAccountOf } from '@mwc/shared/credentials';
import type { Harness, ProfileProvider, ToolProvider } from '@mwc/shared/enums';
import { companiesOf } from '../../../identity/service.ts';
import { agentsUsingProfiles } from '../../../org/service.ts';
import { profileRows as repo } from '../../repo/profiles.ts';
import type {
  AccessProfileView,
  ProfileAgentView,
  ProfilePartsView,
  ProfileSubscriptionView,
} from '../../schemas/profiles.ts';

// What the profiles API shows of a person's profiles (S3.4; generic since 2026-11-13): each with its parts (their
// credentials as metadata) and the agents using it in the owner's companies. Read outside the writes' transactions.

/** The companies a person belongs to (not removed, not deleted), as `GET /api/me` lists them. */
export const companiesOfUser = (db: DbHandle, userId: string) =>
  companiesOf(db, { kind: 'user', via: 'clerk', userId });

/** An agent that uses a profile, and the harness it runs on it (which a part's removal reads). */
export type ProfileUser = ProfileAgentView & { readonly harness: Harness };

/**
 * The agents that use each of these profiles, in the owner's companies (an agent with one of their profiles is in a
 * company they belong to: leaving one takes their profiles off its agents), by profile id.
 */
export async function agentsByProfile(db: DbHandle, userId: string, profileIds: readonly string[]) {
  const uses = new Map<string, ProfileUser[]>();
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
        harness: use.harness,
      };
      uses.set(use.profileId, [...(uses.get(use.profileId) ?? []), agent]);
    }
  }
  return uses;
}

/** Every credential a profile holds: its AI parts' subscriptions and gateways, its tool parts' sign-ins. */
const heldIds = (row: AccessProfile): (string | null)[] => [
  ...Object.values(PROFILE_AI_COLUMNS).flatMap((at) => [row[at.credential], row[at.gateway]]),
  ...TOOL_PROVIDERS.map((tool) => row[PROFILE_TOOL_COLUMNS[tool].credential]),
];

type Shown = (id: string | null) => ProfileSubscriptionView | null;

/** A profile's parts as shown: each part it has, its credentials as metadata (`shownAs`), a tool part's rights. */
function partsOf(row: AccessProfile, shownAs: Shown): ProfilePartsView {
  const ai = (provider: ProfileProvider) => {
    const part = aiPartOf(row, provider);
    if (part === undefined) return null;
    const { credentialId, gatewayCredentialId, model, effort, mode } = part;
    const shown = { subscription: shownAs(credentialId), gateway: shownAs(gatewayCredentialId) };
    return { ...shown, model, effort, mode };
  };
  const tool = <T extends ToolProvider>(provider: T) => {
    const at = PROFILE_TOOL_COLUMNS[provider];
    const rights = row[at.rights];
    return rights === null
      ? null
      : { signIn: shownAs(row[at.credential]), rights: storedRights(provider, rights) };
  };
  return { claude: ai('claude'), openai: ai('openai'), github: tool('github'), atlassian: tool('atlassian') };
}

/** An agent of a profile as the API shows it: without its harness. */
const shownAgent = ({ harness: _, ...agent }: ProfileUser): ProfileAgentView => agent;

/**
 * Profiles as the API shows them: their parts with their credentials as metadata (never a secret; a tool sign-in also
 * with the account and site it acts as) and their rights (`storedRights`), and the agents using each.
 */
export async function views(
  o: OwnedDb,
  rows: readonly AccessProfile[],
  uses: ReadonlyMap<string, ProfileUser[]>,
): Promise<AccessProfileView[]> {
  const ids = rows.flatMap(heldIds).filter((id) => id !== null);
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
  const shownAs: Shown = (id) => (id === null ? null : (held.get(id) ?? null));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parts: partsOf(row, shownAs),
    agents: (uses.get(row.id) ?? []).map(shownAgent),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
