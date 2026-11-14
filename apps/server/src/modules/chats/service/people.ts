import { auditChanges, type Chat, type ChatParticipant, type DbHandle, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { profilesOf } from '../../identity/service.ts';
import { type NewPerson, participantsRepo } from '../repo/participants.ts';
import { chatsRepo } from '../repo.ts';
import {
  type ChatSeat,
  isMessageChat,
  mayJoin,
  mayRemove,
  OWNER_ADDS_SELF,
  PEOPLE_UNSUPPORTED,
  PERSON_IN_CHAT,
  PERSON_NOT_FOUND,
  PERSON_NOT_MEMBER,
  type PeopleChange,
  peopleLine,
  REMOVE_REFUSED,
  seatOf,
} from '../rules/people.ts';
import { CHAT_ARCHIVED, CHAT_NOT_FOUND, type Refusal } from '../rules.ts';
import type { ChatPersonView } from '../schemas/people.ts';
import type { ChatBus } from './bus.ts';
import { recordNote } from './notes.ts';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"): where a member stands in one (`seatIn`, the routes'
 * guard), its people with their names and faces (`peopleOf`), and the changes: any person in the chat adds members, an
 * owner who is not in it adds only themselves (Add me); the chat's creator and the owners take someone out, and anyone
 * leaves. Each change is audited (entity `chat`: `add_person`, `join`, `remove_person`, `leave`), shows as a quiet line
 * in the thread (a `people` turn) and is told to the chats' activity, so the lists of whoever joined or left follow.
 */

/** Who acts on a chat's people. */
export interface PeopleCaller {
  readonly principalId: string;
  readonly role: MembershipRole;
  readonly requestId: string;
}

export interface PeopleDeps {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly bus: Pick<ChatBus, 'publish' | 'changed'>;
}

type People = { readonly ok: true; readonly people: ChatPersonView[] } | Refusal;

/** Where a member stands in the chat; an unknown chat is `open` (its route answers its own 404). */
export async function seatIn(
  t: TenantDb,
  chatId: string,
  who: { readonly principalId: string; readonly role: MembershipRole },
): Promise<ChatSeat> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return 'open';
  const inChat = isMessageChat(chat) && (await participantsRepo.has(t, chat.id, who.principalId));
  return seatOf(chat, inChat, who.role);
}

/** A person's name as the app shows it: their display name, else their email. */
const nameOf = (
  profile: { readonly displayName: string | null; readonly primaryEmail: string } | undefined,
) => (profile === undefined ? 'Former member' : (profile.displayName ?? profile.primaryEmail));

/** The names of these members, by principal. Outside any transaction (the identity read runs on the handle). */
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

/** The chat's people as its header lists them, the earliest added first. */
export async function peopleOf(db: DbHandle, t: TenantDb, chat: Chat): Promise<ChatPersonView[]> {
  const rows = await participantsRepo.ofChat(t, chat.id);
  const principals = rows.flatMap((row) => (row.principalId === null ? [] : [row.principalId]));
  const names = await memberNames(db, t, principals);
  const contactIds = rows.flatMap((row) => (row.contactId === null ? [] : [row.contactId]));
  const contacts = new Map((await participantsRepo.contactsOf(t, contactIds)).map((c) => [c.id, c]));
  return rows.map((row) => {
    const contact = row.contactId === null ? undefined : contacts.get(row.contactId);
    const face =
      row.principalId === null
        ? { name: contact?.name ?? 'Contact', imageUrl: contact?.avatarUrl ?? null }
        : names(row.principalId);
    return {
      id: row.id,
      kind: row.principalId === null ? 'contact' : 'member',
      principalId: row.principalId,
      contactId: row.contactId,
      ...face,
      creator: row.principalId !== null && row.principalId === chat.createdBy,
      addedBy: row.addedBy,
      addedAt: row.addedAt.toISOString(),
    };
  });
}

/** Puts people in a chat as Most Wanted or its creator (a new chat, a branch, a Slack message): no line, no audit. */
export const seatPeople = (t: TenantDb, chatId: string, people: readonly NewPerson[]) =>
  participantsRepo.add(t, chatId, people);

/** The members named, when every one may be in a chat; else why not. */
export async function joinable(t: TenantDb, principalIds: readonly string[]): Promise<string[] | Refusal> {
  const wanted = [...new Set(principalIds)];
  const found = await participantsRepo.members(t, wanted);
  return found.length === wanted.length && found.every(mayJoin) ? wanted : PERSON_NOT_MEMBER;
}

/** Audits a change of the chat's people, and shows it as a line in its thread. */
async function told(deps: PeopleDeps, t: TenantDb, caller: PeopleCaller, chat: Chat, change: Changed) {
  const action = { added: 'add_person', joined: 'join', removed: 'remove_person', left: 'leave' }[change.how];
  const gone = change.how === 'removed' || change.how === 'left';
  await auditChanges(t, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: 'chat',
    entityId: chat.id,
    action,
    changes: [{ field: 'person', old: gone ? change.who : null, new: gone ? null : change.who }],
  });
  const prompt = peopleLine(change.how, change.actor, change.subject);
  await recordNote(deps, t, chat.id, { kind: 'people', prompt, by: caller.principalId });
}

interface Changed {
  readonly how: PeopleChange;
  readonly who: string;
  readonly actor: string;
  readonly subject: string;
}

/** A message chat that is not archived, or why its people cannot change. */
async function changeable(t: TenantDb, chatId: string): Promise<Chat | Refusal> {
  const chat = await chatsRepo.get(t, chatId);
  if (chat === undefined) return CHAT_NOT_FOUND;
  if (!isMessageChat(chat)) return PEOPLE_UNSUPPORTED;
  return chat.archivedAt === null ? chat : CHAT_ARCHIVED;
}

/** Adds members to the chat (see above); its people now, or why not. */
export async function addPeople(
  deps: PeopleDeps,
  t: TenantDb,
  caller: PeopleCaller,
  chatId: string,
  principalIds: readonly string[],
): Promise<People> {
  const chat = await changeable(t, chatId);
  if ('ok' in chat) return chat;
  const self = principalIds.every((id) => id === caller.principalId);
  if (!(await participantsRepo.has(t, chat.id, caller.principalId)) && !self) return OWNER_ADDS_SELF;
  const wanted = await joinable(t, principalIds);
  if (!Array.isArray(wanted)) return wanted;
  const added = await seatPeople(
    t,
    chat.id,
    wanted.map((principalId) => ({ principalId, addedBy: caller.principalId })),
  );
  if (added.length === 0) return PERSON_IN_CHAT;
  const names = await memberNames(deps.db, t, [caller.principalId, ...wanted]);
  const actor = names(caller.principalId).name;
  for (const row of added) {
    const who = row.principalId as string;
    const how = who === caller.principalId ? 'joined' : 'added';
    await told(deps, t, caller, chat, { how, who, actor, subject: names(who).name });
  }
  deps.bus.changed(chat.id);
  return { ok: true, people: await peopleOf(deps.db, t, chat) };
}

/** Takes a person out of the chat, or the caller leaves it (see above); its people now, or why not. */
export async function removePerson(
  deps: PeopleDeps,
  t: TenantDb,
  caller: PeopleCaller,
  chatId: string,
  personId: string,
): Promise<People> {
  const chat = await changeable(t, chatId);
  if ('ok' in chat) return chat;
  const target = (await participantsRepo.ofChat(t, chat.id)).find((row) => row.id === personId);
  if (target === undefined) return PERSON_NOT_FOUND;
  if (!mayRemove(caller, chat, target)) return REMOVE_REFUSED;
  await participantsRepo.remove(t, chat.id, target.id);
  await told(deps, t, caller, chat, await removal(deps, t, caller, target));
  deps.bus.changed(chat.id);
  return { ok: true, people: await peopleOf(deps.db, t, chat) };
}

/** How a removal reads: the caller left, or took out a member or a contact. */
async function removal(deps: PeopleDeps, t: TenantDb, caller: PeopleCaller, target: ChatParticipant) {
  const names = await memberNames(deps.db, t, [caller.principalId, target.principalId ?? caller.principalId]);
  const actor = names(caller.principalId).name;
  if (target.principalId === caller.principalId)
    return { how: 'left', who: caller.principalId, actor, subject: actor } as const;
  if (target.principalId !== null)
    return {
      how: 'removed',
      who: target.principalId,
      actor,
      subject: names(target.principalId).name,
    } as const;
  const [contact] = await participantsRepo.contactsOf(t, [target.contactId as string]);
  return {
    how: 'removed',
    who: target.contactId as string,
    actor,
    subject: contact?.name ?? 'a contact',
  } as const;
}
