import { createHash } from 'node:crypto';
import { CHAT_IMAGE_MAX_BYTES } from '@mwc/shared/chat-images';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Chat,
  type ChatTurn,
  type Company,
  chatImages,
  chats,
  chatTurns,
  type NewChatImage,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertMachine,
  insertPrincipal,
  migratedTestDb,
} from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let chat: Chat;
let by: string;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  const agent = await insertAgent(handle, acme.id);
  const machine = await insertMachine(handle, acme.id);
  by = (await insertPrincipal(handle, acme.id)).id;
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: acme.id,
      agentId: agent.id,
      harness: 'claude_code',
      machineId: machine.id,
      createdBy: by,
    })
    .returning();
  chat = row as Chat;
});
afterAll(() => testDb.close());

let seq = 0;
async function turn(values: Partial<typeof chatTurns.$inferInsert> = {}): Promise<ChatTurn> {
  const [row] = await handle.db
    .insert(chatTurns)
    .values({ companyId: acme.id, chatId: chat.id, seq: ++seq, prompt: 'Look', createdBy: by, ...values })
    .returning();
  return row as ChatTurn;
}

function image(turnId: string, values: Partial<NewChatImage> = {}) {
  return handle.db
    .insert(chatImages)
    .values({
      companyId: acme.id,
      chatId: chat.id,
      turnId,
      position: 0,
      contentType: 'image/png',
      bytes: PNG,
      size: PNG.length,
      sha256: hash(PNG),
      createdBy: by,
      ...values,
    })
    .returning();
}

const constraint = async (query: Promise<unknown>) => (await pgError(query))?.constraint;

describe('chat_images (T-18)', () => {
  it("keeps a message's images with its turn, in order, and the turn names them", async () => {
    const ref = {
      id: '019a5b2e-0000-7000-8000-000000000001',
      contentType: 'image/png',
      size: 10,
      sha256: hash(PNG),
    };
    const t = await turn({ images: [ref] as never });
    const [first] = await image(t.id);
    await image(t.id, { position: 1, contentType: 'image/gif' });
    expect(first).toMatchObject({ turnId: t.id, position: 0, size: PNG.length, createdBy: by });
    expect([...(first?.bytes ?? [])]).toEqual([...PNG]);
    expect(t.images).toEqual([ref]);
  });

  it('refuses a second image at a position, a position past the sixth, another type, a wrong size or hash', async () => {
    const t = await turn();
    await image(t.id);
    expect(await constraint(image(t.id))).toBe('chat_images_turn_position_unique');
    expect(await constraint(image(t.id, { position: 6 }))).toBe('chat_images_position_check');
    expect(await constraint(image(t.id, { position: 1, contentType: 'image/svg+xml' as never }))).toBe(
      'chat_images_content_type_check',
    );
    expect(await constraint(image(t.id, { position: 1, size: PNG.length + 1 }))).toBe(
      'chat_images_size_check',
    );
    expect(await constraint(image(t.id, { position: 1, size: CHAT_IMAGE_MAX_BYTES + 1 }))).toBe(
      'chat_images_size_check',
    );
    expect(await constraint(image(t.id, { position: 1, sha256: 'ABC' }))).toBe('chat_images_sha256_check');
  });

  it("refuses another company's turn, and images on a turn that is not a message", async () => {
    const t = await turn();
    expect(await constraint(image(t.id, { companyId: globex.id }))).toMatch(/^chat_images_/);
    expect(await constraint(turn({ kind: 'compact', images: [] as never }))).toBe('chat_turns_images_check');
    expect(await constraint(turn({ images: {} as never }))).toBe('chat_turns_images_check');
  });

  it('goes with its turn', async () => {
    const t = await turn();
    await image(t.id);
    await handle.db.delete(chatTurns).where(eq(chatTurns.id, t.id));
    expect(await handle.db.select().from(chatImages).where(eq(chatImages.turnId, t.id))).toEqual([]);
  });
});
