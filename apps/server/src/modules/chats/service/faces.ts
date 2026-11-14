import type { Chat, DbHandle, TenantDb } from '@mwc/db';
import { profilesOf } from '../../identity/service.ts';
import { participantsRepo } from '../repo/participants.ts';
import { turnsRepo } from '../repo/turns.ts';
import type { ChatListItemView } from '../schemas/activity.ts';
import type { ChatPersonView } from '../schemas/people.ts';
import { taskNamesOf } from './task-names.ts';
import { chatView, turnView } from './views.ts';

/**
 * The faces of a chat's people (2026-11-14, docs/harness.md "Who is in a chat"): a member's name and photo from the
 * identity module's profiles (display name, else email), a contact's from its row; for one chat (its header) or many at
 * once (the agent's chat list, the chats' activity, each chat with its latest turn): a handful of reads whatever their
 * number. Outside any transaction: the identity read runs on the database handle.
 */

/** A person's name as the app shows it: their display name, else their email. */
const nameOf = (
  profile: { readonly displayName: string | null; readonly primaryEmail: string } | undefined,
) => (profile === undefined ? 'Former member' : (profile.displayName ?? profile.primaryEmail));

/** The names and photos of these members, by principal. */
export async function memberNames(db: DbHandle, t: TenantDb, principalIds: readonly string[]) {
  const members = await participantsRepo.members(t, principalIds);
  const profiles = await profilesOf(
    db,
    members.map((member) => member.userId),
  );
  const users = new Map(members.map((member) => [member.principalId, member.userId]));
  return (principalId: string) => {
    const userId = users.get(principalId);
    const profile = userId === undefined ? undefined : profiles.get(userId);
    return { name: nameOf(profile), imageUrl: profile?.imageUrl ?? null };
  };
}

/** The people of these chats, the earliest added first, per chat (each chat named has an entry). */
export async function peopleOfChats(
  db: DbHandle,
  t: TenantDb,
  chats: readonly Pick<Chat, 'id' | 'createdBy'>[],
): Promise<Map<string, ChatPersonView[]>> {
  const out = new Map(chats.map((chat) => [chat.id, [] as ChatPersonView[]]));
  const rows = await participantsRepo.ofChats(t, [...out.keys()]);
  const principals = rows.flatMap((row) => row.principalId ?? []);
  const names = await memberNames(db, t, principals);
  const contactIds = rows.flatMap((row) => row.contactId ?? []);
  const contacts = new Map((await participantsRepo.contactsOf(t, contactIds)).map((c) => [c.id, c]));
  const creators = new Map(chats.map((chat) => [chat.id, chat.createdBy]));
  for (const row of rows) {
    const contact = row.contactId === null ? undefined : contacts.get(row.contactId);
    const face =
      row.principalId === null
        ? { name: contact?.name ?? 'Contact', imageUrl: contact?.avatarUrl ?? null }
        : names(row.principalId);
    out.get(row.chatId)?.push({
      id: row.id,
      kind: row.principalId === null ? 'contact' : 'member',
      principalId: row.principalId,
      contactId: row.contactId,
      ...face,
      creator: row.principalId !== null && row.principalId === creators.get(row.chatId),
      addedBy: row.addedBy,
      addedAt: row.addedAt.toISOString(),
    });
  }
  return out;
}

/** One chat's people as its header lists them, the earliest added first. */
export const peopleOf = async (db: DbHandle, t: TenantDb, chat: Pick<Chat, 'id' | 'createdBy'>) =>
  (await peopleOfChats(db, t, [chat])).get(chat.id) as ChatPersonView[];

/**
 * These chats as a list shows them: each with its people, its latest turn that talks with the agent and, a task's
 * conversation, what names it (T-19).
 */
export async function listItems(
  db: DbHandle,
  t: TenantDb,
  chats: readonly Chat[],
): Promise<ChatListItemView[]> {
  const people = await peopleOfChats(db, t, chats);
  const ids = chats.map((chat) => chat.id);
  const last = new Map((await turnsRepo.lastTalksOf(t, ids)).map((turn) => [turn.chatId, turnView(turn)]));
  const tasks = await taskNamesOf(t, chats);
  return chats.map((chat) => ({
    ...chatView(chat),
    people: people.get(chat.id) as ChatPersonView[],
    lastTurn: last.get(chat.id) ?? null,
    forTask: tasks.get(chat.id) ?? null,
  }));
}
