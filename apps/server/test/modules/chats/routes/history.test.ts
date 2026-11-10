import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { detailOf, messages, olderOf, seedTurns, seqs } from '../../../fixtures/chats/history.ts';
import { openStream, type SseMessage } from '../../../fixtures/chats/stream.ts';
import { type ChatsWorld, chatPath, chatsWorld, scene } from '../../../fixtures/chats/world.ts';
import { addMember, membersCompany } from '../../../fixtures/members/members.ts';

let w: ChatsWorld;
const streams: { close(): Promise<void> }[] = [];
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  for (const stream of streams.splice(0)) await stream.close();
});
afterAll(() => w.close());

describe('GET chats/:chatId/turns', () => {
  it("pages back from the detail's earlier.before, the latest first, each page in order with its events", async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, messages(45));
    const chat = await detailOf(w, s);
    expect(chat.earlier).toMatchObject({ before: 16, turns: 15 });
    const all = await olderOf(w, s, 'beforeSeq=16');
    expect([all.status, seqs(all.body.turns), all.body.more]).toEqual([200, range(1, 15), false]);
    expect(all.body.turns[0]?.events.map((e) => e.event)).toEqual([{ type: 'text', text: 'Reply 1' }]);
    const first = await olderOf(w, s, 'beforeSeq=16&limit=10');
    expect([seqs(first.body.turns), first.body.more]).toEqual([range(6, 15), true]);
    const next = await olderOf(w, s, 'beforeSeq=6&limit=10');
    expect([seqs(next.body.turns), next.body.more]).toEqual([range(1, 5), false]);
  });

  it('keeps a page inside one conversation with afterSeq', async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, ['message', 'message', 'clear', ...messages(3)]);
    const before = await olderOf(w, s, 'beforeSeq=3&afterSeq=0');
    expect([seqs(before.body.turns), before.body.more]).toEqual([[1, 2], false]);
    const current = await olderOf(w, s, 'beforeSeq=7&afterSeq=2');
    expect(current.body.turns.map((t) => [t.seq, t.kind])).toEqual([
      [3, 'clear'],
      [4, 'message'],
      [5, 'message'],
      [6, 'message'],
    ]);
    const tail = await olderOf(w, s, 'beforeSeq=7&afterSeq=3&limit=2');
    expect([seqs(tail.body.turns), tail.body.more]).toEqual([[5, 6], true]);
    const empty = await olderOf(w, s, 'beforeSeq=4&afterSeq=3');
    expect(empty.body).toEqual({ turns: [], more: false });
    expect((await olderOf(w, s, 'beforeSeq=1')).body).toEqual({ turns: [], more: false });
  });

  it('takes 1 to 50 turns, a beforeSeq from 1 and an afterSeq from 0', async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, messages(55));
    const most = await olderOf(w, s, 'beforeSeq=56&limit=50');
    expect([most.body.turns.length, most.body.more]).toEqual([50, true]);
    for (const query of [
      '',
      'beforeSeq=0',
      'beforeSeq=two',
      'beforeSeq=1.5',
      'beforeSeq=5&limit=0',
      'beforeSeq=5&limit=51',
      'beforeSeq=5&afterSeq=-1',
    ]) {
      const res = await olderOf(w, s, query);
      expect([query, res.status]).toEqual([query, 400]);
    }
  });

  it('is for members and above, and a 404 for an unknown chat or one of another company', async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, messages(2));
    const member = await olderOf(w, s, 'beforeSeq=3', await addMember(w, s.company, 'member'));
    expect([member.status, seqs(member.body.turns)]).toEqual([200, [1, 2]]);
    const viewer = await olderOf(w, s, 'beforeSeq=3', await addMember(w, s.company, 'viewer'));
    expect(viewer.status).toBe(403);
    const unknown = await olderOf(w, { ...s, chat: { ...s.chat, id: 'nope' } }, 'beforeSeq=3');
    expect([unknown.status, unknown.body]).toMatchObject([404, { error: { code: 'chat_not_found' } }]);
    const other = await membersCompany(w);
    const theirs = await olderOf(w, { company: other, chat: s.chat }, 'beforeSeq=3', other.owner);
    expect([theirs.status, theirs.body]).toMatchObject([404, { error: { code: 'chat_not_found' } }]);
  });

  it("leaves the stream's replay as it was: from the detail's position on, never the paged turns", async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, messages(40));
    const chat = await detailOf(w, s);
    expect((await olderOf(w, s, `beforeSeq=${chat.earlier.before}`)).body.turns).toHaveLength(10);
    const last = chat.turns.at(-1);
    await seedTurns(w, s, messages(2), 41);
    const stream = await openStream(w.t.app, chatPath(s.company, s.chat.id, '/stream'), {
      authorization: `Bearer fake:${s.company.owner.subject}`,
      'last-event-id': `${last?.seq}.${last?.events.at(-1)?.seq}`,
    });
    streams.push(stream);
    await stream.until('the replay', (m) => shape(m).length === 5);
    expect(shape(stream.messages)).toEqual(['turn 40', 'turn 41', 'event 41.1', 'turn 42', 'event 42.1']);
  });
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const shape = (messages: SseMessage[]) =>
  messages
    .filter((message) => message.comment === undefined)
    .map((message) =>
      message.event === 'turn'
        ? `turn ${(message.data as { turn: { seq: number } }).turn.seq}`
        : `event ${message.id}`,
    );
