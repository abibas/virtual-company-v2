/**
 * The access profiles' test helpers (S3.4), split from `../org.ts`, which re-exports them: subscriptions of every kind
 * sealed as the store seals them, profiles made straight through the personal layer and put on agents and defaults
 * straight in the tables, and raw reads of both; for a profile's tool parts (S7.1b, one profile since 2026-11-13) GitHub
 * and Atlassian sign-ins with a fake account's details.
 */
import { randomBytes } from 'node:crypto';
import {
  type AccessProfile,
  accessProfiles,
  agents,
  auditLog,
  credentials,
  type DbHandle,
  memberships,
  owned,
  tenant,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { CredentialKind, ProfileProvider } from '@mwc/shared/enums';
import { and, asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { credentialSecrets, type StoreCredentialInput } from '../../../src/modules/credentials/index.ts';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import type { Keyring } from '../../../src/platform/secrets/keyring.ts';
import type { AuthWorld } from '../platform/auth.ts';

export const PROFILES = '/api/me/access-profiles';

export const defaultPath = (companyId: string) => `/api/companies/${companyId}/me/default-profile`;

/** A secret of each kind's shape: made up, never a real one. */
const SECRETS: Readonly<Record<CredentialKind, unknown>> = {
  claude_oauth: {
    credentials: { claudeAiOauth: { accessToken: 'sk-ant-oat01-LOGINaccessNEVERshown' } },
    account: { emailAddress: 'ihor@example.com' },
  },
  claude_setup_token: { token: 'sk-ant-oat01-SETUPtokenNEVERshownAGAIN_0123456789' },
  codex_oauth: { auth: { tokens: { access_token: 'codex-ACCESStokenNEVERshown' } } },
  anthropic_api_key: { apiKey: 'sk-ant-api03-ANTHROPICkeyNEVERshown_abcdef' },
  openai_api_key: { apiKey: 'sk-proj-OPENAIkeyNEVERshown_ghijkl' },
  gateway: { headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' } },
  github_oauth: { token: 'gho_GHLOGINtokenNEVERshown' },
  github_token: { token: 'ghp_GHPASTEDtokenNEVERshown' },
  atlassian_api_token: {
    site: 'airia.atlassian.net',
    email: 'ihor@example.com',
    token: 'ATATT3ATLASSIANtokenNEVERshown',
  },
};

/** Asserts a body (or rows) carry no secret of the subscriptions these helpers seal. */
export function noSecret(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of [
    'LOGINaccess',
    'SETUPtoken',
    'codex-ACCESS',
    'ANTHROPICkey',
    'OPENAIkey',
    'HEADERvalue',
    'GHLOGINtoken',
    'GHPASTEDtoken',
    'ATLASSIANtoken',
  ]) {
    expect(text).not.toContain(secret);
  }
}

/** Seals a subscription of `kind` for a person, as the store does (`storeCredential`). */
export function addSubscription(
  w: AuthWorld,
  keyring: Keyring,
  userId: string,
  kind: CredentialKind,
  label = `${kind} ${randomBytes(2).toString('hex')}`,
): Promise<SubscriptionView> {
  const input = { kind, secret: SECRETS[kind], label, ownerUserId: userId } as StoreCredentialInput;
  return credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).storeCredential(input);
}

/** The fake account each tool sign-in acts as: GitHub's login, Atlassian's name, email and site. */
export const TOOL_ACCOUNTS = {
  github_oauth: {
    accountEmail: null,
    accountMeta: { host: 'github.com', login: 'ihor-fake', name: 'Ihor Fake' },
  },
  github_token: {
    accountEmail: null,
    accountMeta: { host: 'github.com', login: 'ihor-pat', tokenType: 'classic' },
  },
  atlassian_api_token: {
    accountEmail: 'ihor@example.test',
    accountMeta: {
      site: 'airia-fake.atlassian.net',
      jira: true,
      confluence: true,
      displayName: 'Ihor Herasko',
    },
  },
} as const;

/** Seals a GitHub or Atlassian sign-in for a person with its fake account's details (`TOOL_ACCOUNTS`), as the store does. */
export function addSignIn(
  w: AuthWorld,
  keyring: Keyring,
  userId: string,
  kind: keyof typeof TOOL_ACCOUNTS,
): Promise<SubscriptionView> {
  const input = {
    kind,
    secret: SECRETS[kind],
    label: `${kind} ${randomBytes(2).toString('hex')}`,
    ownerUserId: userId,
  };
  const store = credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
  return store.storeCredential({ ...input, ...TOOL_ACCOUNTS[kind] } as StoreCredentialInput);
}

/** Marks a subscription revoked at its provider, straight in the table. */
export async function revokeSubscription(db: DbHandle, id: string): Promise<void> {
  await rawDb(db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, id));
}

/** A profile of a person's (a Claude one unless `provider` says), straight through the personal layer (no rules checked). */
export async function seedProfile(
  db: DbHandle,
  userId: string,
  values: Partial<Omit<AccessProfile, 'id' | 'ownerUserId'>> = {},
): Promise<AccessProfile> {
  const name = `Profile ${randomBytes(3).toString('hex')}`;
  const [row] = await owned(db, userId)
    .insert(accessProfiles, { name, provider: 'claude', ...values })
    .returning();
  return row as AccessProfile;
}

/** Puts a profile on an agent straight in the table (no rules checked). */
export async function putProfile(db: DbHandle, companyId: string, agentId: string, profileId: string | null) {
  await (await tenant(db, companyId)).update(agents, { profileId }, eq(agents.id, agentId));
}

/** The membership column of each provider's default profile. */
const DEFAULT_FIELDS = { claude: 'defaultClaudeProfileId', openai: 'defaultOpenaiProfileId' } as const;

/** Sets a membership's default profile of a provider (Claude by default) straight in the table (no rules checked). */
export async function putDefault(
  db: DbHandle,
  membershipId: string,
  profileId: string | null,
  provider: ProfileProvider = 'claude',
) {
  await rawDb(db)
    .update(memberships)
    .set({ [DEFAULT_FIELDS[provider]]: profileId })
    .where(eq(memberships.id, membershipId));
}

/** The profile an agent holds, as stored. */
export const agentProfileOf = async (db: DbHandle, agentId: string) =>
  (await rawDb(db).select().from(agents).where(eq(agents.id, agentId)))[0]?.profileId;

/** A profile's tool part columns as stored. */
export async function profileToolsOf(db: DbHandle, profileId: string) {
  const [row] = await rawDb(db).select().from(accessProfiles).where(eq(accessProfiles.id, profileId));
  const { githubCredentialId, githubRights, atlassianCredentialId, atlassianRights } = row as AccessProfile;
  return { githubCredentialId, githubRights, atlassianCredentialId, atlassianRights };
}

/** The default profile of a provider (Claude by default) a membership holds, as stored. */
export const defaultProfileOf = async (
  db: DbHandle,
  membershipId: string,
  provider: ProfileProvider = 'claude',
) =>
  (await rawDb(db).select().from(memberships).where(eq(memberships.id, membershipId)))[0]?.[
    DEFAULT_FIELDS[provider]
  ];

/** One field's audit rows of an entity, oldest first, as `[companyId, action, by, requestId, old, new]`. */
export async function fieldAudit(db: DbHandle, entityType: string, entityId: string, field: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId), eq(auditLog.field, field)),
    )
    .orderBy(asc(auditLog.id));
  return rows.map(
    (row) =>
      [
        row.companyId,
        row.action,
        row.actorPrincipalId ?? row.actorKind,
        row.requestId,
        row.oldValue,
        row.newValue,
      ] as const,
  );
}
