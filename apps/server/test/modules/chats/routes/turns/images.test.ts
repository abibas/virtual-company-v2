import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGES_MAX } from '@mwc/shared/chat-images';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGE_BODY_MAX } from '../../../../../src/modules/chats/rules/images.ts';
import type { ChatTurnView } from '../../../../../src/modules/chats/schemas.ts';
import { base64, imageRows, sendImages } from '../../../../fixtures/chats/images.ts';
import { detailOf, queued, runningTurn, turnPath } from '../../../../fixtures/chats/queue.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  eventually,
  scene,
  turnRow,
} from '../../../../fixtures/chats/world.ts';
import { GIF, JPEG, PNG, pngOfSize, SVG, sha256 } from '../../../../fixtures/companies/logos.ts';
import { as } from '../../../../fixtures/members/members.ts';

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
const codeOf = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code?: string } }).error?.code,
];
const turnsOf = async (s: Awaited<ReturnType<typeof scene>>) => (await detailOf(w, s)).turns;

describe('POST chats/:chatId/turns with images (T-18)', () => {
  it('keeps the images with the turn, shows them in its view, and names them in the spec sent to the runner', async () => {
    const s = await scene(w, { caps: IMAGES });
    const res = await sendImages(w, s, 'What is on these?', [PNG, JPEG]);
    expect(res.status).toBe(202);
    const turn = res.body as ChatTurnView;
    const rows = await imageRows(w.t.db, turn.id);
    expect(rows.map((row) => [row.position, row.contentType, row.size, row.sha256, row.chatId])).toEqual([
      [0, 'image/png', PNG.length, sha256(PNG), s.chat.id],
      [1, 'image/jpeg', JPEG.length, sha256(JPEG), s.chat.id],
    ]);
    expect(rows[0]?.createdBy).toBe(s.company.owner.principalId);
    expect(turn.images).toEqual(
      rows.map((row) => ({ id: row.id, contentType: row.contentType, size: row.size })),
    );
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start.spec.prompt).toBe('What is on these?');
    expect(start.spec.images).toEqual(
      rows.map((row) => ({ id: row.id, contentType: row.contentType, size: row.size, sha256: row.sha256 })),
    );
    expect(JSON.stringify(start)).not.toContain(base64(PNG));
    expect((await turnsOf(s)).at(-1)?.images).toEqual(turn.images);
  });

  it('sends no images field for a message without them, and shows an empty list', async () => {
    const s = await scene(w, { caps: IMAGES });
    const res = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), {
      prompt: 'Hi',
    });
    expect((res.body as ChatTurnView).images).toEqual([]);
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect('images' in start.spec).toBe(false);
  });

  it('refuses images that are not base64, too large, not an image, too many, or a body over the limit', async () => {
    const s = await scene(w, { caps: IMAGES });
    expect(codeOf(await sendImages(w, s, 'x', [`data:image/png;base64,${base64(PNG)}`]))).toEqual([
      400,
      'image_invalid',
    ]);
    expect(codeOf(await sendImages(w, s, 'x', ['abc']))).toEqual([400, 'image_invalid']);
    expect(codeOf(await sendImages(w, s, 'x', [PNG, pngOfSize(CHAT_IMAGE_MAX_BYTES + 1)]))).toEqual([
      413,
      'image_too_large',
    ]);
    expect(codeOf(await sendImages(w, s, 'x', ['A'.repeat(CHAT_IMAGE_MAX_BYTES * 2)]))).toEqual([
      413,
      'image_too_large',
    ]);
    expect(codeOf(await sendImages(w, s, 'x', [SVG]))).toEqual([415, 'image_type_unsupported']);
    expect(codeOf(await sendImages(w, s, 'x', Array(CHAT_IMAGES_MAX + 1).fill(GIF)))).toEqual([
      400,
      'invalid_request',
    ]);
    const huge = JSON.stringify({ prompt: 'x', images: [{ data: 'A'.repeat(MESSAGE_BODY_MAX) }] });
    const res = await w.t.app.request(chatPath(s.company, s.chat.id, '/turns'), {
      method: 'POST',
      body: huge,
      headers: {
        authorization: `Bearer fake:${s.company.owner.subject}`,
        'content-type': 'application/json',
      },
    });
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([
      413,
      'message_too_large',
    ]);
    expect(await turnsOf(s)).toEqual([]);
  });

  it('takes the largest image there may be', async () => {
    const s = await scene(w, { caps: IMAGES });
    const res = await sendImages(w, s, 'big', [pngOfSize(CHAT_IMAGE_MAX_BYTES)]);
    expect(res.status).toBe(202);
    expect((res.body as ChatTurnView).images[0]?.size).toBe(CHAT_IMAGE_MAX_BYTES);
  });

  it("refuses a message with images when the machine's runner is older than them, and records nothing", async () => {
    const s = await scene(w);
    const res = await sendImages(w, s, 'look', [PNG]);
    expect(codeOf(res)).toEqual([409, 'runner_outdated']);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/cannot take images/);
    expect(await turnsOf(s)).toEqual([]);
  });
});

describe('a message with images while a turn runs (T-18)', () => {
  it('waits after the running turn and starts with its images when it ends', async () => {
    const s = await scene(w, { caps: IMAGES });
    const first = await runningTurn(w, s);
    const res = await sendImages(w, s, 'And this one?', [GIF], { delivery: 'after' });
    const waiting = res.body as ChatTurnView;
    expect([res.status, waiting.status, waiting.images.length]).toEqual([202, 'queued', 1]);
    endTurn(s.runner as FakeRunner, first.turnId);
    await ended(w.t.db, first.turnId);
    const next = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(next.turnId).toBe(waiting.id);
    expect(next.spec.images?.map((image) => image.sha256)).toEqual([sha256(GIF)]);
  });

  it('never goes into the running turn when sent Now: it starts first once the turn ends', async () => {
    const s = await scene(w, { caps: IMAGES });
    const first = await runningTurn(w, s);
    const runner = s.runner as FakeRunner;
    const res = await sendImages(w, s, 'See this', [PNG], { delivery: 'now' });
    expect((res.body as ChatTurnView).delivery).toBe('now');
    await queued(w, s, 'later', 'after');
    endTurn(runner, first.turnId);
    await ended(w.t.db, first.turnId);
    const next = await runner.frames.next('turn.start');
    expect(next.turnId).toBe((res.body as ChatTurnView).id);
    expect(runner.frames.of('turn.input')).toEqual([]);
  });

  it('fails a waiting message with images when the runner it would start on is older than them', async () => {
    const s = await scene(w);
    const first = await runningTurn(w, s);
    const res = await sendImages(w, s, 'look', [PNG], { delivery: 'after' });
    const waiting = res.body as ChatTurnView;
    expect(res.status).toBe(202);
    endTurn(s.runner as FakeRunner, first.turnId);
    await ended(w.t.db, first.turnId);
    await eventually(
      'the waiting turn fails',
      async () => (await turnRow(w.t.db, waiting.id))?.status === 'failed',
    );
    expect((await turnRow(w.t.db, waiting.id))?.error).toMatch(/cannot take images/);
  });

  it('removes the images of a waiting message that is discarded', async () => {
    const s = await scene(w, { caps: IMAGES });
    await runningTurn(w, s);
    const waiting = (await sendImages(w, s, 'drop me', [PNG, GIF], { delivery: 'after' }))
      .body as ChatTurnView;
    expect(await imageRows(w.t.db, waiting.id)).toHaveLength(2);
    const res = await as(w, s.company.owner)('DELETE', turnPath(s, waiting.id));
    expect(res.status).toBe(204);
    expect(await imageRows(w.t.db, waiting.id)).toEqual([]);
  });
});
