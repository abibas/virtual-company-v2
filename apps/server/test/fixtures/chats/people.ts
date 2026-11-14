/**
 * Who is in a chat, for the chats tests (2026-11-14, docs/harness.md "Who is in a chat"): putting people in a chat
 * through its route, as someone in it (its creator, the company's owner by default); the test fails on anything but a
 * 200.
 */
import type { MachinesWorld } from '../machines/world.ts';
import { as, type MembersCompany } from '../members/members.ts';
import type { Person } from '../platform/auth.ts';
import { chatPath } from './world.ts';

/** Puts these people in the chat, as `by` (the owner by default). */
export async function addToChat(
  w: MachinesWorld,
  company: MembersCompany,
  chatId: string,
  people: readonly Pick<Person, 'principalId'>[],
  by: Person = company.owner,
): Promise<void> {
  const principalIds = people.map((person) => person.principalId);
  const res = await as(w, by)('POST', chatPath(company, chatId, '/people'), { principalIds });
  if (res.status !== 200) throw new Error(`POST people answered ${res.status}: ${JSON.stringify(res.body)}`);
}
