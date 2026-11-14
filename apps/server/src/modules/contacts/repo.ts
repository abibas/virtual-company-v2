import { type Contact, contacts, isUuid, type NewContact, type TenantDb, type TenantSet } from '@mwc/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

/**
 * The contacts' rows (2026-11-14, docs/subscriptions.md "Contacts"), through the company's tenant only: one by its id or
 * by its Slack workspace and person, the list (the latest seen first), and the writes. What they said and to whom is in
 * `repo/conversations.ts`.
 */

/** One contact; undefined for an unknown or malformed id. */
async function get(t: TenantDb, id: string): Promise<Contact | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(contacts, eq(contacts.id, id));
  return row;
}

/** The company's contacts, the latest seen first: all, or those not archived. */
const list = (t: TenantDb, archived: boolean): Promise<Contact[]> =>
  t
    .select(contacts, archived ? undefined : isNull(contacts.archivedAt))
    .orderBy(desc(contacts.lastSeenAt), desc(contacts.id));

/** These contacts (none for no ids). */
const byIds = (t: TenantDb, ids: readonly string[]): Promise<Contact[]> =>
  ids.length === 0 ? Promise.resolve([]) : t.select(contacts, inArray(contacts.id, [...ids]));

/** The contact of a Slack workspace's person; undefined for none yet. */
async function bySlack(t: TenantDb, teamId: string, userId: string): Promise<Contact | undefined> {
  const [row] = await t.select(
    contacts,
    and(eq(contacts.slackTeamId, teamId), eq(contacts.slackUserId, userId)),
  );
  return row;
}

/** A new contact; undefined when one of the same Slack person was made meanwhile. */
async function insert(t: TenantDb, values: Omit<NewContact, 'companyId'>): Promise<Contact | undefined> {
  const [row] = await t.insert(contacts, values).onConflictDoNothing().returning();
  return row;
}

/** Changes a contact; undefined for an unknown one. */
async function update(
  t: TenantDb,
  id: string,
  set: TenantSet<typeof contacts>,
): Promise<Contact | undefined> {
  const [row] = await t.update(contacts, set, eq(contacts.id, id)).returning();
  return row;
}

export const contactsRepo = { get, list, byIds, bySlack, insert, update };
