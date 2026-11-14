import {
  type ChatImage,
  chatImages,
  chats,
  chatTurns,
  isUuid,
  type TenantDb,
  type TenantValues,
} from '@mwc/db';
import { and, eq, sql } from 'drizzle-orm';

/** The images of chat messages (T-18, `chat_images`), through the company's tenant only. */

/** Writes a turn's images. */
async function insert(t: TenantDb, rows: readonly TenantValues<typeof chatImages>[]): Promise<void> {
  if (rows.length > 0) await t.insert(chatImages, rows);
}

/** One image of the chat; undefined for an unknown, malformed or another chat's id. */
async function ofChat(t: TenantDb, chatId: string, imageId: string): Promise<ChatImage | undefined> {
  if (!isUuid(imageId)) return undefined;
  const [row] = await t.select(chatImages, and(eq(chatImages.chatId, chatId), eq(chatImages.id, imageId)));
  return row;
}

/**
 * One image of the turn, while its chat lives on `machineId` (what a runner may fetch: a turn on its own machine);
 * undefined otherwise, or for a malformed id.
 */
async function forRunner(
  t: TenantDb,
  where: { readonly turnId: string; readonly imageId: string; readonly machineId: string },
): Promise<ChatImage | undefined> {
  if (!isUuid(where.turnId) || !isUuid(where.imageId)) return undefined;
  const onMachine = sql`exists (select 1 from ${chatTurns} join ${chats} on ${chats.companyId} = ${chatTurns.companyId} and ${chats.id} = ${chatTurns.chatId} where ${chatTurns.companyId} = ${chatImages.companyId} and ${chatTurns.id} = ${chatImages.turnId} and ${chats.machineId} = ${where.machineId})`;
  const [row] = await t.select(
    chatImages,
    and(eq(chatImages.turnId, where.turnId), eq(chatImages.id, where.imageId), onMachine),
  );
  return row;
}

export const imagesRepo = { insert, ofChat, forRunner };
