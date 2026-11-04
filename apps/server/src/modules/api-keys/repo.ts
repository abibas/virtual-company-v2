import {
  type ApiKey,
  type AuditEntry,
  apiKeys,
  auditChanges,
  isUuid,
  type Membership,
  memberships,
  type TenantDb,
  type TenantValues,
} from '@mwc/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

/** This module serves personal keys only; runner keys come with machines (S3), SCIM keys later. */
const personal = eq(apiKeys.kind, 'personal');
const newestFirst = [desc(apiKeys.createdAt), desc(apiKeys.id)] as const;

/**
 * Locks the company row until the transaction ends, so a key made here and a removal (which revokes the person's
 * keys under the same lock) run one after the other, then reads the acting member's membership as it is now.
 */
async function lockedMember(t: TenantDb, membershipId: string): Promise<Membership | undefined> {
  await t.lockCompany();
  const [row] = await t.select(memberships, eq(memberships.id, membershipId));
  return row;
}

async function insert(t: TenantDb, values: TenantValues<typeof apiKeys>): Promise<ApiKey> {
  const [row] = (await t.insert(apiKeys, values).returning()) as [ApiKey];
  return row;
}

/** One personal key of this company by id; undefined for an unknown or malformed id, another company's or kind. */
async function get(t: TenantDb, id: string): Promise<ApiKey | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(apiKeys, and(eq(apiKeys.id, id), personal));
  return row;
}

/** The personal keys of one principal, newest first, revoked and expired ones too. */
const listOf = (t: TenantDb, principalId: string): Promise<ApiKey[]> =>
  t.select(apiKeys, and(personal, eq(apiKeys.principalId, principalId))).orderBy(...newestFirst);

/** Every personal key in the company, newest first. */
const listAll = (t: TenantDb): Promise<ApiKey[]> => t.select(apiKeys, personal).orderBy(...newestFirst);

/** Sets `revoked_at` unless it is set already; returns the key revoked now, or undefined when it was already. */
async function revoke(t: TenantDb, id: string, at: Date): Promise<ApiKey | undefined> {
  const notYet = and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt));
  const [row] = await t.update(apiKeys, { revokedAt: at }, notYet).returning();
  return row;
}

/** The memberships of these principals (whose keys they are), whatever their status. */
const membersOf = (t: TenantDb, principalIds: readonly string[]): Promise<Membership[]> =>
  principalIds.length === 0
    ? Promise.resolve([])
    : t.select(memberships, inArray(memberships.principalId, [...principalIds]));

/**
 * The API keys module's data access, through the company's tenant only: its personal keys, the acting member's
 * membership under the company's lock, the owners' memberships, and the audit rows. No hash leaves this module.
 */
export function apiKeysRepo() {
  return {
    lockedMember,
    insert,
    get,
    listOf,
    listAll,
    revoke,
    membersOf,
    audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
  };
}

export type ApiKeysRepo = ReturnType<typeof apiKeysRepo>;
