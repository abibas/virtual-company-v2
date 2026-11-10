import type { TurnEvent } from '@mwc/shared/harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detailOf, messages, seedTurns, seqs, turnAt } from '../../../fixtures/chats/history.ts';
import { type ChatsWorld, chatsWorld, scene } from '../../../fixtures/chats/world.ts';

/** The chat's detail holds its current conversation, the latest 30 turns, and says what it left out (through the API). */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterAll(() => w.close());

const INIT: TurnEvent = { type: 'init', model: 'claude-opus-5-5', slashCommands: ['compact'] };
const OLD_INIT: TurnEvent = { type: 'init', model: 'claude-sonnet-4-5', slashCommands: [] };
const CONTEXT: TurnEvent = {
  type: 'context',
  inputTokens: 3,
  cacheReadTokens: 150_000,
  cacheCreationTokens: 2000,
  outputTokens: 40,
  window: 1_000_000,
};

describe('GET chats/:chatId: the current conversation', () => {
  it('holds every turn of a chat that was never cleared, and nothing is left out', async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, [{ events: [INIT, CONTEXT] }, ...messages(4)]);
    const chat = await detailOf(w, s);
    expect(seqs(chat.turns)).toEqual([1, 2, 3, 4, 5]);
    expect(chat.turns[0]?.events.map((e) => e.event.type)).toEqual(['init', 'context', 'text']);
    expect(chat.earlier).toEqual({ before: null, turns: 0, conversations: [] });
    expect(chat.init).toEqual(INIT);
    expect(chat.context).toMatchObject({ usedTokens: 152_003, window: 1_000_000 });
  });

  it('starts at the last Clear (its turn first) and describes the conversation before it', async () => {
    const s = await scene(w, { offline: true });
    const ids = await seedTurns(w, s, [
      { events: [INIT, CONTEXT] },
      'message',
      'message',
      'clear',
      'message',
    ]);
    const chat = await detailOf(w, s);
    expect(chat.turns.map((t) => [t.seq, t.kind])).toEqual([
      [4, 'clear'],
      [5, 'message'],
    ]);
    expect(chat.earlier).toEqual({
      before: null,
      turns: 0,
      conversations: [
        { clearTurnId: ids[3], clearSeq: 4, clearedAt: turnAt(4), turns: 3, from: turnAt(1), to: turnAt(3) },
      ],
    });
    expect([chat.init, chat.context]).toEqual([null, null]);
  });

  it('describes each conversation before several Clears, newest first', async () => {
    const s = await scene(w, { offline: true });
    const ids = await seedTurns(w, s, [
      ...messages(2),
      'clear',
      'message',
      'clear',
      ...messages(3),
      'clear',
      'message',
    ]);
    const chat = await detailOf(w, s);
    expect(seqs(chat.turns)).toEqual([9, 10]);
    expect(chat.earlier.conversations).toEqual([
      { clearTurnId: ids[8], clearSeq: 9, clearedAt: turnAt(9), turns: 3, from: turnAt(6), to: turnAt(8) },
      { clearTurnId: ids[4], clearSeq: 5, clearedAt: turnAt(5), turns: 1, from: turnAt(4), to: turnAt(4) },
      { clearTurnId: ids[2], clearSeq: 3, clearedAt: turnAt(3), turns: 2, from: turnAt(1), to: turnAt(2) },
    ]);
  });

  it('holds the latest 30 turns of a long conversation and still reads what it runs on from all of it', async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, [
      { events: [OLD_INIT] },
      'clear',
      { events: [INIT] },
      'message',
      { events: [CONTEXT] },
      ...messages(42),
    ]);
    const chat = await detailOf(w, s);
    expect(chat.turns).toHaveLength(30);
    expect(seqs(chat.turns)).toEqual(Array.from({ length: 30 }, (_, i) => 18 + i));
    expect(chat.turns.every((t) => t.events.length === 1)).toBe(true);
    expect(chat.earlier).toMatchObject({ before: 18, turns: 16 });
    expect(chat.earlier.conversations.map((c) => [c.clearSeq, c.turns])).toEqual([[2, 1]]);
    expect(chat.init).toEqual(INIT);
    expect(chat.context).toEqual({
      usedTokens: 152_003,
      window: 1_000_000,
      model: 'claude-opus-5-5',
      at: turnAt(5),
    });
  });

  it("sizes a conversation whose events name no window by what the chat's access profile runs", async () => {
    const unsized: TurnEvent = { ...CONTEXT, window: null };
    const codex = await scene(w, { harness: 'codex', offline: true, model: null });
    await seedTurns(w, codex, [{ events: [unsized] }]);
    expect((await detailOf(w, codex)).context).toMatchObject({
      usedTokens: 152_003,
      window: 272_000,
      model: null,
    });
    const typed = await scene(w, { offline: true, model: 'claude-haiku-4-5' });
    await seedTurns(w, typed, [{ events: [unsized] }]);
    expect((await detailOf(w, typed)).context).toMatchObject({ window: 200_000 });
  });

  it('leaves nothing out of a conversation of exactly 30 turns', async () => {
    const s = await scene(w, { offline: true });
    await seedTurns(w, s, messages(30));
    const chat = await detailOf(w, s);
    expect(chat.turns).toHaveLength(30);
    expect(chat.earlier).toEqual({ before: null, turns: 0, conversations: [] });
  });

  it('shows an empty chat as no turns and nothing earlier', async () => {
    const s = await scene(w, { offline: true });
    const chat = await detailOf(w, s);
    expect([chat.turns, chat.earlier]).toEqual([[], { before: null, turns: 0, conversations: [] }]);
  });
});
