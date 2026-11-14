import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatTurnView } from '../../../../src/modules/chats/schemas.ts';
import { getImage, runnerGetImage, sendImages } from '../../../fixtures/chats/images.ts';
import { type ChatsWorld, chatsWorld, scene } from '../../../fixtures/chats/world.ts';
import { JPEG, PNG, sha256 } from '../../../fixtures/companies/logos.ts';
import { addMember } from '../../../fixtures/members/members.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const MISSING = '019a5b2e-0000-7000-8000-000000000000';

/** A chat with a message of two images (a PNG, then a JPEG) on a runner that takes images. */
async function withImages() {
  const s = await scene(w, { caps: { images: true } });
  const turn = (await sendImages(w, s, 'look', [PNG, JPEG])).body as ChatTurnView;
  await (s.runner as FakeRunner).frames.next('turn.start');
  return { s, turn, png: turn.images[0]?.id as string, jpeg: turn.images[1]?.id as string };
}

describe('GET chats/:chatId/images/:imageId (T-18)', () => {
  it("answers the image's bytes to the chat's people, with its type and ETag, cached for good", async () => {
    const { s, png, jpeg } = await withImages();
    const res = await getImage(w, s, png);
    expect(res.status).toBe(200);
    expect(res.bytes).toEqual(PNG);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('etag')).toBe(`"${sha256(PNG)}"`);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await getImage(w, s, jpeg)).bytes).toEqual(JPEG);
  });

  it('answers 304 when If-None-Match names it', async () => {
    const { s, png } = await withImages();
    const res = await w.t.app.request(
      `/api/companies/${s.company.companyId}/chats/${s.chat.id}/images/${png}`,
      {
        headers: {
          authorization: `Bearer fake:${s.company.owner.subject}`,
          'if-none-match': `"${sha256(PNG)}"`,
        },
      },
    );
    expect(res.status).toBe(304);
  });

  it("is the chat's: a member who is not in it, another chat's id and an unknown image get a 404", async () => {
    const { s, png } = await withImages();
    const outsider = await addMember(w, s.company, 'member');
    expect([(await getImage(w, s, png, outsider)).body?.error.code]).toEqual(['chat_not_found']);
    const other = await scene(w, { caps: { images: true } });
    expect((await getImage(w, other, png, other.company.owner)).body?.error.code).toBe('image_not_found');
    expect((await getImage(w, s, MISSING)).body?.error.code).toBe('image_not_found');
    expect((await getImage(w, s, 'not-a-uuid')).body?.error.code).toBe('image_not_found');
  });
});

describe('GET /api/runner/turns/:turnId/images/:imageId (T-18)', () => {
  it("answers the runner of the chat's machine the bytes with their SHA-256", async () => {
    const { s, turn, png } = await withImages();
    const res = await runnerGetImage(w, s.runnerKey, turn.id, png);
    expect(res.status).toBe(200);
    expect(res.bytes).toEqual(PNG);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-mwc-runner-sha256')).toBe(sha256(PNG));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it("refuses another machine's runner, another turn's id, and a call without a runner key", async () => {
    const { s, turn, png } = await withImages();
    const other = await scene(w, { caps: { images: true } });
    expect((await runnerGetImage(w, other.runnerKey, turn.id, png)).status).toBe(404);
    expect((await runnerGetImage(w, s.runnerKey, MISSING, png)).body?.error.code).toBe('image_not_found');
    expect((await runnerGetImage(w, s.runnerKey, turn.id, 'nope')).status).toBe(404);
    expect((await runnerGetImage(w, undefined, turn.id, png)).status).toBe(401);
    expect((await runnerGetImage(w, `fake:${s.company.owner.subject}`, turn.id, png)).status).toBe(401);
  });
});
