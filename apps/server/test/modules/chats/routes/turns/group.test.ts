import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../../src/modules/chats/schemas.ts';
import { addToChat } from '../../../../fixtures/chats/people.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  scene,
  sendPrompt,
  turnRow,
} from '../../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../../fixtures/members/members.ts';

/**
 * A person's message in a chat with several people (2026-11-14, docs/harness.md "Who is in a chat"): the agent gets
 * the writer's name first, so it knows who asks, and the thread keeps what they wrote (the turn's visible text); a
 * waiting message's edit keeps the header; a message that no longer fits with the name first is refused. A chat of one
 * person sends a message as written.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const refusal = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];

describe('a message in a chat with several people', () => {
  it("goes to the agent with its writer's name first, and shows as they wrote it", async () => {
    const s = await scene(w);
    const admin = await addMember(w, s.company, 'admin');
    await addToChat(w, s.company, s.chat.id, [admin]);
    const res = await sendPrompt(w, s, 'What is 2 + 2?', admin);
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start.spec.prompt).toBe(`Message from ${admin.subject}:\n\nWhat is 2 + 2?`);
    expect(res.body).toMatchObject({
      status: 'running',
      prompt: start.spec.prompt,
      visibleText: 'What is 2 + 2?',
      createdBy: admin.principalId,
      from: null,
    });
    // The chat's title is what they wrote, as for any first message.
    const chat = await as(w, admin)('GET', chatPath(s.company, s.chat.id));
    expect((chat.body as { title: string }).title).toBe('What is 2 + 2?');
  });

  it('keeps the header on a waiting message edited, and refuses one that no longer fits', async () => {
    const s = await scene(w);
    const admin = await addMember(w, s.company, 'admin');
    await addToChat(w, s.company, s.chat.id, [admin]);
    expect((await sendPrompt(w, s, 'Go')).status).toBe(202);
    const owner = as(w, s.company.owner);
    const waiting = await owner('POST', chatPath(s.company, s.chat.id, '/turns'), {
      prompt: 'And 3 + 3?',
      delivery: 'after',
    });
    const turn = waiting.body as ChatTurnView;
    const header = turn.prompt.slice(0, turn.prompt.length - 'And 3 + 3?'.length);
    expect([turn.status, header, turn.visibleText]).toEqual([
      'queued',
      expect.stringMatching(/^Message from Owner \S+:\n\n$/),
      'And 3 + 3?',
    ]);
    const edited = await owner('PATCH', chatPath(s.company, s.chat.id, `/turns/${turn.id}`), {
      prompt: 'And 4 + 4?',
    });
    expect(edited.body).toMatchObject({ prompt: `${header}And 4 + 4?`, visibleText: 'And 4 + 4?' });
    const long = 'x'.repeat(20_000);
    const tooLong = await owner('PATCH', chatPath(s.company, s.chat.id, `/turns/${turn.id}`), {
      prompt: long,
    });
    expect(refusal(tooLong)).toEqual([422, 'prompt_too_long']);
    const sent = await sendPrompt(w, s, long, admin);
    expect(refusal(sent)).toEqual([422, 'prompt_too_long']);
    expect((sent.body as { error: { message: string } }).error.message).toContain(
      `by ${`Message from ${admin.subject}:\n\n`.length} characters`,
    );
  });
});

describe('a message in a chat of one person', () => {
  it('goes as written, with no visible text of its own', async () => {
    const s = await scene(w);
    const res = await sendPrompt(w, s, 'Hello');
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start.spec.prompt).toBe('Hello');
    expect((await turnRow(w.t.db, (res.body as ChatTurnView).id))?.visibleText).toBeNull();
  });
});
