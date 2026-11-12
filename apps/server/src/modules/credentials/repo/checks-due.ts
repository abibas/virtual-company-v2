import { type Credential, credentials, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TOOL_CREDENTIAL_KINDS } from '@mwc/shared/credentials';
import { and, asc, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { TOOL_CHECK_EVERY_MS, TOOL_RETRY_MS } from '../rules/tools.ts';

/**
 * The tool sign-ins due for their daily check, across every person (S7.1a, the jobs loop): the one place this module
 * reads without the personal layer, listed in biome.json's exemption, since anyone's sign-in may be due. It only finds;
 * each sign-in is opened, checked and changed through its owner's layer (`service/tools/check.ts`). The condition is
 * `toolCheckDue` in SQL (the tests hold both to it).
 */

/** Up to `limit` due tool sign-ins, never checked or longest ago first. */
export function dueToolChecks(db: DbHandle, now: Date, limit: number): Promise<Credential[]> {
  const before = (ms: number) => new Date(now.getTime() - ms);
  return rawDb(db)
    .select()
    .from(credentials)
    .where(
      and(
        inArray(credentials.kind, [...TOOL_CREDENTIAL_KINDS]),
        ne(credentials.status, 'revoked'),
        or(
          isNull(credentials.checkedAt),
          lte(credentials.checkedAt, before(TOOL_CHECK_EVERY_MS)),
          and(isNotNull(credentials.checkError), lte(credentials.checkedAt, before(TOOL_RETRY_MS))),
        ),
      ),
    )
    .orderBy(sql`${credentials.checkedAt} asc nulls first`, asc(credentials.id))
    .limit(limit);
}
