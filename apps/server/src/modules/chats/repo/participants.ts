import {
  type ChatParticipant,
  chatParticipants,
  chats,
  contacts,
  isUuid,
  memberships,
  type TenantDb,
} from '@mwc/db';
import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"), through the company's tenant only: the chats'
 * people, and what the rules read of the people they name (the memberships, read only: the members module's rows; the
 * contacts, read only: the contacts module's).
 */

/** One person to put in a chat: a member by principal or a contact, and who added them (null: Most Wanted). */
export type NewPerson = { readonly addedBy: string | null } & (
  | { readonly principalId: string; readonly contactId?: undefined }
  | { readonly contactId: string; readonly principalId?: undefined }
);

/** The chat's people, the earliest added first; none for a malformed id. */
const ofChat = (t: TenantDb, chatId: string): Promise<ChatParticipant[]> =>
  isUuid(chatId)
    ? t
        .select(chatParticipants, eq(chatParticipants.chatId, chatId))
        .orderBy(asc(chatParticipants.addedAt), asc(chatParticipants.id))
    : Promise.resolve([]);

/** The people of these chats, the earliest added first. */
const ofChats = (t: TenantDb, chatIds: readonly string[]): Promise<ChatParticipant[]> =>
  chatIds.length === 0
    ? Promise.resolve([])
    : t
        .select(chatParticipants, inArray(chatParticipants.chatId, [...chatIds]))
        .orderBy(asc(chatParticipants.addedAt), asc(chatParticipants.id));

/** True when this member is in the chat. */
async function has(t: TenantDb, chatId: string, principalId: string): Promise<boolean> {
  if (!isUuid(principalId)) return false;
  const [row] = await t.selectFields(
    chatParticipants,
    { id: chatParticipants.id },
    and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.principalId, principalId)),
  );
  return row !== undefined;
}

/** Puts people in the chat; those already in are left as they are. The rows added. */
async function add(t: TenantDb, chatId: string, people: readonly NewPerson[]): Promise<ChatParticipant[]> {
  if (people.length === 0) return [];
  const rows = people.map((person) => ({
    chatId,
    principalId: person.principalId ?? null,
    contactId: person.contactId ?? null,
    addedBy: person.addedBy,
  }));
  return t.insert(chatParticipants, rows).onConflictDoNothing().returning();
}

/** Takes one person out of the chat by their row's id; undefined when they are not in it. */
async function remove(t: TenantDb, chatId: string, id: string): Promise<ChatParticipant | undefined> {
  if (!isUuid(id)) return undefined;
  const where = and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.id, id));
  const [row] = await t.delete(chatParticipants, where).returning();
  return row;
}

/** The members of these chats (their principals), per chat. */
async function membersOf(t: TenantDb, chatIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (chatIds.length === 0) return out;
  const rows = await t.selectFields(
    chatParticipants,
    { chatId: chatParticipants.chatId, principalId: chatParticipants.principalId },
    and(inArray(chatParticipants.chatId, [...chatIds]), isNotNull(chatParticipants.principalId)),
  );
  for (const row of rows) out.set(row.chatId, [...(out.get(row.chatId) ?? []), row.principalId as string]);
  return out;
}

/** A membership as the rules read it. */
export interface MemberRow {
  readonly principalId: string;
  readonly userId: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
}

const memberFields = {
  principalId: memberships.principalId,
  userId: memberships.userId,
  role: memberships.role,
  status: memberships.status,
};

/** The memberships of these principals (well-formed ids only); a principal of no person is left out. */
function members(t: TenantDb, principalIds: readonly string[]): Promise<MemberRow[]> {
  const ids = principalIds.filter(isUuid);
  if (ids.length === 0) return Promise.resolve([]);
  return t.selectFields(memberships, memberFields, inArray(memberships.principalId, ids));
}

/** This person's membership of the company; undefined when they have none. */
async function memberOfUser(t: TenantDb, userId: string): Promise<MemberRow | undefined> {
  const [row] = await t.selectFields(memberships, memberFields, eq(memberships.userId, userId));
  return row;
}

/** These contacts' names and faces. */
const contactsOf = (t: TenantDb, ids: readonly string[]) =>
  ids.length === 0
    ? Promise.resolve([])
    : t.selectFields(
        contacts,
        { id: contacts.id, name: contacts.name, avatarUrl: contacts.avatarUrl },
        inArray(contacts.id, [...ids]),
      );

/** `chats.id` names a chat this member is in (a condition on `chats`). */
export const memberIn = (principalId: string) =>
  sql`exists (select 1 from chat_participants p where p.company_id = ${chats.companyId} and p.chat_id = ${chats.id} and p.principal_id = ${principalId})`;

export const participantsRepo = {
  ofChat,
  ofChats,
  has,
  add,
  remove,
  membersOf,
  members,
  memberOfUser,
  contactsOf,
};
