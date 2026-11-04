import { createHash } from 'node:crypto';
import { apiKeys, type DbHandle, memberships, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { ApiKeyKind } from '@mwc/shared/enums';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { type AuthResult, unauthenticated } from './actor.ts';

/** An API key: `mwc_<pk|rk|sc>_` and 32 base62 characters, shown once when it is made (S1.9). */
export const API_KEY_PATTERN = /^mwc_(pk|rk|sc)_[0-9A-Za-z]{32}$/;

const KIND_OF_PREFIX: Readonly<Record<string, ApiKeyKind>> = { pk: 'personal', rk: 'runner', sc: 'scim' };

/** `last_used_at` is written at most this often per key. */
export const LAST_USED_INTERVAL_MS = 60_000;

/** The kind a well-formed key's prefix names, or null for anything that is not an API key. */
export function apiKeyKind(key: string): ApiKeyKind | null {
  const match = API_KEY_PATTERN.exec(key);
  return match ? (KIND_OF_PREFIX[match[1] ?? ''] ?? null) : null;
}

/** What `api_keys.secret_hash` stores: the SHA-256 of the whole key, as 64 lower-case hex digits. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Records the use, unless the key was used less than a minute ago (also checked in SQL, for races). */
async function touch(handle: DbHandle, id: string, lastUsedAt: Date | null, now: Date, logger: Logger) {
  const due = new Date(now.getTime() - LAST_USED_INTERVAL_MS);
  if (lastUsedAt !== null && lastUsedAt > due) return;
  try {
    await rawDb(handle)
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(and(eq(apiKeys.id, id), or(isNull(apiKeys.lastUsedAt), lte(apiKeys.lastUsedAt, due))));
  } catch (error) {
    // Bookkeeping only: a failed write never fails the request.
    logger.warn({ err: error, apiKeyId: id }, 'api key: last_used_at not recorded');
  }
}

/**
 * The caller behind an API key, found by the key's SHA-256. A personal key acts as its principal's user in
 * its company only. Unknown, revoked and expired keys are refused (401), and so are runner and SCIM keys
 * until their routes exist (S3, later).
 */
export async function checkApiKey(
  handle: DbHandle,
  key: string,
  now: Date,
  logger: Logger,
): Promise<AuthResult> {
  const kind = apiKeyKind(key);
  if (kind === null) return unauthenticated('The API key is not valid');
  if (kind !== 'personal') return unauthenticated('This kind of API key is not accepted here');
  const [row] = await rawDb(handle)
    .select({
      id: apiKeys.id,
      kind: apiKeys.kind,
      companyId: apiKeys.companyId,
      principalId: apiKeys.principalId,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      userId: memberships.userId,
      userStatus: users.status,
    })
    .from(apiKeys)
    .leftJoin(
      memberships,
      and(eq(memberships.companyId, apiKeys.companyId), eq(memberships.principalId, apiKeys.principalId)),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(eq(apiKeys.secretHash, hashApiKey(key)));
  if (!row || row.kind !== kind || row.userId === null) return unauthenticated('The API key is not valid');
  if (row.revokedAt !== null) return unauthenticated('The API key was revoked');
  if (row.expiresAt !== null && row.expiresAt <= now) return unauthenticated('The API key has expired');
  if (row.userStatus === 'deactivated') {
    return { ok: false, status: 403, code: 'user_deactivated', message: 'This account is deactivated' };
  }
  await touch(handle, row.id, row.lastUsedAt, now, logger);
  return {
    ok: true,
    actor: {
      kind: 'user',
      via: 'api_key',
      userId: row.userId,
      principalId: row.principalId,
      companyId: row.companyId,
      apiKeyId: row.id,
    },
  };
}
