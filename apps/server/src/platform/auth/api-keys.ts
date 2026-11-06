import { createHash, randomBytes } from 'node:crypto';
import { apiKeys, companies, type DbHandle, machines, memberships, users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import {
  API_KEY_ALPHABET,
  API_KEY_PREFIXES,
  API_KEY_SECRET_LENGTH,
  apiKeyKind,
  apiKeyPrefix,
} from '@mwc/shared/api-keys';
import type { ApiKeyKind } from '@mwc/shared/enums';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { type AuthFailure, type AuthResult, unauthenticated } from './actor.ts';

/** The key format is shared with the CLI (`@mwc/shared/api-keys`): `mwc_<pk|rk|sc>_` and 32 base62 characters. */
export { API_KEY_PATTERN, apiKeyKind } from '@mwc/shared/api-keys';

/** `last_used_at` is written at most this often per key. */
export const LAST_USED_INTERVAL_MS = 60_000;

/** What `api_keys.secret_hash` stores: the SHA-256 of the whole key, as 64 lower-case hex digits. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** A random byte below this maps to a base62 character without bias (248 = 4 × 62); larger ones are drawn again. */
const UNBIASED_BELOW = 248;

/**
 * `length` base62 characters from the system's CSPRNG (`randomBytes`), drawn without modulo bias: bytes of 248 and
 * above are thrown away. `random` is injectable for the test of that rejection only.
 */
export function randomBase62(length: number, random: (size: number) => Uint8Array = randomBytes): string {
  let out = '';
  while (out.length < length) {
    for (const byte of random(length)) {
      if (byte < UNBIASED_BELOW && out.length < length) out += API_KEY_ALPHABET[byte % 62];
    }
  }
  return out;
}

/** A new key as it is stored (`prefix`, `secretHash`) and, once, shown (`key`). */
export interface GeneratedApiKey {
  readonly key: string;
  readonly prefix: string;
  readonly secretHash: string;
}

/**
 * A new API key of this kind: `mwc_<pk|rk|sc>_` and 32 base62 characters from the CSPRNG, its display prefix and its
 * SHA-256. The key itself is returned to be shown once and is never stored or logged.
 */
export function generateApiKey(kind: ApiKeyKind): GeneratedApiKey {
  const key = `mwc_${API_KEY_PREFIXES[kind]}_${randomBase62(API_KEY_SECRET_LENGTH)}`;
  return { key, prefix: apiKeyPrefix(key), secretHash: hashApiKey(key) };
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

/** Who a runner key belongs to: its machine, the machine's company and the key's row. */
export interface RunnerCredential {
  readonly companyId: string;
  readonly machineId: string;
  readonly apiKeyId: string;
}

export type RunnerAuthResult = { readonly ok: true; readonly runner: RunnerCredential } | AuthFailure;

/**
 * The machine behind a runner key (`mwc_rk_...`), found by the key's SHA-256: what opens a runner's socket and nothing
 * else (S4.2). Unknown, revoked and expired keys are refused (401), and so are the keys of a removed machine or a
 * deleted company. A use is recorded at most once a minute, as for personal keys.
 */
export async function checkRunnerKey(
  handle: DbHandle,
  key: string,
  now: Date,
  logger: Logger,
): Promise<RunnerAuthResult> {
  if (apiKeyKind(key) !== 'runner') return unauthenticated('A runner key (mwc_rk_...) is required');
  const [row] = await rawDb(handle)
    .select({
      id: apiKeys.id,
      companyId: apiKeys.companyId,
      machineId: machines.id,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      removedAt: machines.removedAt,
      companyStatus: companies.status,
      companyDeletedAt: companies.deletedAt,
    })
    .from(apiKeys)
    .innerJoin(machines, and(eq(machines.companyId, apiKeys.companyId), eq(machines.id, apiKeys.machineId)))
    .innerJoin(companies, eq(companies.id, apiKeys.companyId))
    .where(and(eq(apiKeys.secretHash, hashApiKey(key)), eq(apiKeys.kind, 'runner')));
  if (!row || row.companyStatus === 'deleted' || row.companyDeletedAt !== null) {
    return unauthenticated('The runner key is not valid');
  }
  if (row.revokedAt !== null) return unauthenticated('The runner key was revoked');
  if (row.expiresAt !== null && row.expiresAt <= now) return unauthenticated('The runner key has expired');
  if (row.removedAt !== null) return unauthenticated('The machine was removed');
  await touch(handle, row.id, row.lastUsedAt, now, logger);
  return { ok: true, runner: { companyId: row.companyId, machineId: row.machineId, apiKeyId: row.id } };
}
