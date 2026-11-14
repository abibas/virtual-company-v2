import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatPersonView } from '../../../../../src/modules/chats/schemas/people.ts';
import type { ChatTurnView } from '../../../../../src/modules/chats/schemas.ts';
import { type OpenActivity, openActivity } from '../../../../fixtures/chats/activity.ts';
import { addToChat } from '../../../../fixtures/chats/people.ts';
import { type OpenStream, openStream } from '../../../../fixtures/chats/stream.ts';
import { beginChat, type ChatsWorld, chatPath, chatsWorld, scene } from '../../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../../fixtures/members/members.ts';
import type { Person } from '../../../../fixtures/platform/auth.ts';

/**
 * Who hears a chat (2026-11-14, docs/harness.md "Who is in a chat"): the chats' activity tells each person only the
 * chats they are in, with their people, so a person added hears the chat from then on; and a person taken out of a
 * chat is cut off its stream at that line.
 */

let w: ChatsWorld;
const open: (OpenActivity | OpenStream)[] = [];
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  for (const stream of open.splice(0)) await stream.close();
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const lines = (stream: OpenStream) =>
  stream.messages
    .filter((m) => m.event === 'turn')
    .map((m) => (m.data as { turn: ChatTurnView }).turn)
    .filter((turn) => turn.kind === 'people')
    .map((turn) => turn.prompt);

async function listenTo(path: string, person: Person): Promise<OpenStream> {
  const stream = await openStream(w.t.app, path, { authorization: `Bearer fake:${person.subject}` });
  open.push(stream);
  return stream;
}

describe("the chats' activity and a chat's stream", () => {
  it('tell a person a chat once they are added, with its people', async () => {
    const s = await scene(w, { offline: true });
    const anna = await addMember(w, s.company, 'member');
    const live = await openActivity(w.t.app, s.company.companyId, anna);
    open.push(live);
    const chat = await beginChat(w, s.company, s.agentId);
    await as(w, s.company.owner)('PATCH', chatPath(s.company, chat.id), { title: 'Plans' });
    await addToChat(w, s.company, chat.id, [anna]);
    const told = await live.next('the chat once in it', (v) => v.chat.id === chat.id);
    // Its first word to them is after its rename: nothing of it was told while they were not in it.
    expect(told.chat.title).toBe('Plans');
    expect(told.chat.people.map((p: ChatPersonView) => p.principalId)).toEqual([
      s.company.owner.principalId,
      anna.principalId,
    ]);
  });

  it('cut a person taken out of the chat off its stream at that line', async () => {
    const s = await scene(w, { offline: true });
    const anna = await addMember(w, s.company, 'member');
    const bob = await addMember(w, s.company, 'member');
    await addToChat(w, s.company, s.chat.id, [anna]);
    const theirs = await listenTo(chatPath(s.company, s.chat.id, '/stream'), anna);
    const mine = await listenTo(chatPath(s.company, s.chat.id, '/stream'), s.company.owner);
    const people = (await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id))).body as {
      people: ChatPersonView[];
    };
    const place = people.people.find((p) => p.principalId === anna.principalId)?.id as string;
    expect(
      (await as(w, s.company.owner)('DELETE', chatPath(s.company, s.chat.id, `/people/${place}`))).status,
    ).toBe(200);
    await theirs.until('the line of their removal', () => lines(theirs).length === 1);
    await addToChat(w, s.company, s.chat.id, [bob]);
    await mine.until('both lines', () => lines(mine).length === 2);
    expect(lines(theirs)).toEqual([expect.stringMatching(new RegExp(`removed ${anna.subject}$`))]);
  });
});
