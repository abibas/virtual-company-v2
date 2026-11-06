import { companies, type DbHandle, enrollmentTokens } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { API_KEY_SECRET_LENGTH } from '@mwc/shared/api-keys';
import { ENROLLMENT_TOKEN_PATTERN } from '@mwc/shared/runner-protocol';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { hashApiKey, randomBase62 } from './api-keys.ts';

/**
 * Enrollment tokens (S4.2, docs/runner-protocol.md): the one-time credential `POST /api/runner/enroll` takes, made by an
 * admin. Like an API key, only its SHA-256 is stored and the token itself is shown once.
 */

/** A new token as it is stored (`secretHash`) and, once, shown (`token`): `mwc_et_` and 32 base62 characters. */
export function generateEnrollmentToken(): { readonly token: string; readonly secretHash: string } {
  const token = `mwc_et_${randomBase62(API_KEY_SECRET_LENGTH)}`;
  return { token, secretHash: hashApiKey(token) };
}

/**
 * The row and company of an enrollment token, by its SHA-256 across every company (the token is the only credential of
 * the enroll call, so its company is not known before); undefined for a malformed or unknown token, or one of a deleted
 * company. Whether it is used or expired is the machines module's to decide, in the company's transaction that uses it.
 */
export async function findEnrollmentToken(
  handle: DbHandle,
  token: string,
): Promise<{ readonly id: string; readonly companyId: string } | undefined> {
  if (!ENROLLMENT_TOKEN_PATTERN.test(token)) return undefined;
  const [row] = await rawDb(handle)
    .select({ id: enrollmentTokens.id, companyId: enrollmentTokens.companyId })
    .from(enrollmentTokens)
    .innerJoin(companies, eq(companies.id, enrollmentTokens.companyId))
    .where(
      and(
        eq(enrollmentTokens.secretHash, hashApiKey(token)),
        ne(companies.status, 'deleted'),
        isNull(companies.deletedAt),
      ),
    );
  return row;
}
