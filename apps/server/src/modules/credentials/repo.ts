import {
  type Credential,
  credentials,
  credentialUses,
  isUuid,
  type OwnedAuditEntry,
  type OwnedDb,
  type OwnedSet,
  type OwnedValues,
} from '@mwc/db';
import { asc, eq } from 'drizzle-orm';

/**
 * The credentials module's data access, through the personal layer only (`owned(db, userId)` of `@mwc/db`): every
 * read, write and audit row is the owner's. No sealed column leaves this module but to be opened by its service.
 */

/** The owner's credentials, oldest first. */
const list = (o: OwnedDb): Promise<Credential[]> =>
  o.select(credentials).orderBy(asc(credentials.createdAt), asc(credentials.id));

/** One of the owner's credentials; undefined for another person's, an unknown id or one that is not an id. */
async function get(o: OwnedDb, id: string): Promise<Credential | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await o.select(credentials, eq(credentials.id, id));
  return row;
}

async function insert(o: OwnedDb, values: OwnedValues<typeof credentials>): Promise<Credential> {
  const [row] = (await o.insert(credentials, values).returning()) as [Credential];
  return row;
}

/** Changes one of the owner's credentials, by the id of a row read first; undefined when it is not theirs (or is gone). */
async function update(
  o: OwnedDb,
  id: string,
  set: OwnedSet<typeof credentials>,
): Promise<Credential | undefined> {
  const [row] = await o.update(credentials, set, eq(credentials.id, id)).returning();
  return row;
}

/** Removes one of the owner's credentials; returns it, or undefined when it was not theirs. Its uses stay. */
async function remove(o: OwnedDb, id: string): Promise<Credential | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await o.delete(credentials, eq(credentials.id, id)).returning();
  return row;
}

/** What a use was for in a company (a chat's turn or terminal): the company, the agent, the chat and who asked. */
export interface UseContext {
  readonly companyId: string;
  readonly agentId: string;
  readonly chatId: string;
  readonly principalId: string;
}

/**
 * Records a server-side use of a credential's secret (with what it was for in a company, when it was) and moves its
 * `last_used_at`, in one transaction. A use is not a change: `updated_at` keeps the value it had.
 */
function recordUse(
  o: OwnedDb,
  row: Credential,
  purpose: string,
  at: Date,
  context?: UseContext,
): Promise<void> {
  return o.transaction(async (tx) => {
    await tx.insert(credentialUses, { credentialId: row.id, purpose, at, ...context });
    await tx.update(credentials, { lastUsedAt: at, updatedAt: row.updatedAt }, eq(credentials.id, row.id));
  });
}

export function credentialsRepo() {
  return {
    list,
    get,
    insert,
    update,
    remove,
    recordUse,
    audit: (o: OwnedDb, entry: OwnedAuditEntry) => o.audit(entry),
  };
}

export type CredentialsRepo = ReturnType<typeof credentialsRepo>;
