import { CHAT_PROMPT } from '@mwc/shared/chats';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IMAGE_ORDER_NOTE } from '../../../../src/modules/chats/rules/images.ts';
import { groupHeader } from '../../../../src/modules/chats/rules/people.ts';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { sendImages } from '../../../fixtures/chats/images.ts';
import { addToChat } from '../../../fixtures/chats/people.ts';
import { detailOf, runningTurn, turnPath } from '../../../fixtures/chats/queue.ts';
import { type ChatsWorld, chatsWorld, type Scene, scene, sendPrompt } from '../../../fixtures/chats/world.ts';
import { GIF, PNG } from '../../../fixtures/companies/logos.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';

/**
 * A person's message as the agent gets it (T-20, docs/harness.md "Images in a message", the Markers bullet): a text that
 * marks its images (`[Image 1]`, …) opens with the line that says they come in the order of their markers, kept out of
 * what the thread shows; before the writer's name in a chat with several people. No images, or no marker, no line; and
 * the line is dropped when it would make the prompt too long.
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

const IMAGES = { images: true } as const;
const NOTE = `${IMAGE_ORDER_NOTE}\n\n`;
const MARKED = 'Compare [Image 1] with [Image 2]: which is newer?';

/** What the runner was asked, and the turn as the thread shows it. */
async function asked(s: Scene, res: { status: number; body: unknown }) {
  expect(res.status).toBe(202);
  const start = await (s.runner as FakeRunner).frames.next('turn.start');
  const turn = (await detailOf(w, s)).turns.find((one) => one.id === (res.body as ChatTurnView).id);
  return { prompt: start.spec.prompt, turn };
}

/** A scene whose chat has an admin besides its owner. */
async function groupScene(): Promise<{ readonly s: Scene; readonly admin: Person }> {
  const s = await scene(w, { caps: IMAGES });
  const admin = await addMember(w, s.company, 'admin');
  await addToChat(w, s.company, s.chat.id, [admin]);
  return { s, admin };
}

describe('a message of one person', () => {
  it('that marks its images opens with the order line for the agent, and shows as written', async () => {
    const s = await scene(w, { caps: IMAGES });
    const { prompt, turn } = await asked(s, await sendImages(w, s, MARKED, [PNG, GIF]));
    expect(prompt).toBe(`${NOTE}${MARKED}`);
    expect(turn).toMatchObject({ prompt, visibleText: MARKED });
    expect(turn?.images).toHaveLength(2);
  });

  it('goes as written with markers but no images, or images but no markers', async () => {
    const s = await scene(w, { caps: IMAGES });
    const first = await asked(s, await sendPrompt(w, s, MARKED));
    expect(first.prompt).toBe(MARKED);
    expect(first.turn).toMatchObject({ prompt: MARKED, visibleText: null });
    const other = await scene(w, { caps: IMAGES });
    const second = await asked(other, await sendImages(w, other, 'What is on this one?', [PNG]));
    expect(second.prompt).toBe('What is on this one?');
    expect(second.turn?.visibleText).toBeNull();
  });

  it('drops the line when it would make the prompt too long', async () => {
    const s = await scene(w, { caps: IMAGES });
    const long = `[Image 1] ${'x'.repeat(CHAT_PROMPT.max - 10 - NOTE.length + 1)}`;
    expect(long.length).toBeLessThanOrEqual(CHAT_PROMPT.max);
    const { prompt, turn } = await asked(s, await sendImages(w, s, long, [PNG]));
    expect(prompt).toBe(long);
    expect(turn?.visibleText).toBeNull();
    const fits = `[Image 1] ${'x'.repeat(CHAT_PROMPT.max - 10 - NOTE.length)}`;
    const other = await scene(w, { caps: IMAGES });
    const kept = await asked(other, await sendImages(w, other, fits, [PNG]));
    expect(kept.prompt).toBe(`${NOTE}${fits}`);
    expect(kept.prompt).toHaveLength(CHAT_PROMPT.max);
  });
});

describe('a message in a chat with several people', () => {
  it("opens with the order line, then its writer's name, and shows as written", async () => {
    const { s, admin } = await groupScene();
    const { prompt, turn } = await asked(s, await sendImages(w, s, MARKED, [PNG, GIF], { person: admin }));
    expect(prompt).toBe(`${NOTE}${groupHeader(admin.subject)}${MARKED}`);
    expect(turn).toMatchObject({ prompt, visibleText: MARKED, createdBy: admin.principalId });
  });

  it("has only its writer's name without a marker or without images", async () => {
    const { s, admin } = await groupScene();
    const plain = await asked(s, await sendImages(w, s, 'What is this?', [PNG], { person: admin }));
    expect(plain.prompt).toBe(`${groupHeader(admin.subject)}What is this?`);
    expect(plain.turn?.visibleText).toBe('What is this?');
    const other = await groupScene();
    const marked = await asked(other.s, await sendPrompt(w, other.s, MARKED, other.admin));
    expect(marked.prompt).toBe(`${groupHeader(other.admin.subject)}${MARKED}`);
  });

  it('drops the line when it would make the prompt too long, keeping the name', async () => {
    const { s, admin } = await groupScene();
    const header = groupHeader(admin.subject);
    const text = `[Image 1] ${'y'.repeat(CHAT_PROMPT.max - header.length - 10 - 1)}`;
    const { prompt, turn } = await asked(s, await sendImages(w, s, text, [PNG], { person: admin }));
    expect(prompt).toBe(`${header}${text}`);
    expect(turn?.visibleText).toBe(text);
    const tooLong = await sendImages(w, s, `[Image 1] ${'z'.repeat(CHAT_PROMPT.max - 10)}`, [PNG], {
      person: admin,
    });
    expect([tooLong.status, (tooLong.body as { error: { code: string } }).error.code]).toEqual([
      422,
      'prompt_too_long',
    ]);
  });

  it('keeps the line and the name on a waiting message edited, the thread showing the new text', async () => {
    const { s, admin } = await groupScene();
    await runningTurn(w, s);
    const res = await sendImages(w, s, MARKED, [PNG, GIF], { person: admin, delivery: 'after' });
    const waiting = res.body as ChatTurnView;
    expect([waiting.status, waiting.prompt]).toEqual([
      'queued',
      `${NOTE}${groupHeader(admin.subject)}${MARKED}`,
    ]);
    const edited = await as(w, admin)('PATCH', turnPath(s, waiting.id), { prompt: 'Only [Image 2] matters' });
    expect(edited.body).toMatchObject({
      prompt: `${NOTE}${groupHeader(admin.subject)}Only [Image 2] matters`,
      visibleText: 'Only [Image 2] matters',
    });
  });
});
