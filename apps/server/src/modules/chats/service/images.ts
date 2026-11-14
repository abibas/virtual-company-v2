import {
  type ChatImage,
  type ChatTurn,
  type chatTurns,
  type DbHandle,
  type TenantDb,
  type TenantValues,
  tenant,
} from '@mwc/db';
import type { TurnSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { imagesRepo } from '../repo/images.ts';
import { turnsRepo } from '../repo/turns.ts';
import { imageRecords, imagesOf, type MessageImage } from '../rules/images.ts';

/**
 * The images of a chat message (T-18, docs/harness.md "Images in a message"): written with the message's turn, in the
 * transaction that records it (whether it starts at once, waits in the queue or waits for its machine), the turn naming
 * them; added to the turn's spec each time it goes to the runner; read back by the chat's people (the web) and by the
 * runner of the chat's machine, which fetches them before the turn starts.
 */

/** Records a turn with its message's images, if any: the turn names them, their bytes go beside it. */
export async function insertTurn(
  tx: TenantDb,
  values: TenantValues<typeof chatTurns>,
  images: readonly MessageImage[] | undefined,
): Promise<ChatTurn> {
  if (images === undefined || images.length === 0) return turnsRepo.insert(tx, values);
  const { refs, rows } = imageRecords(images, newId);
  const turn = await turnsRepo.insert(tx, { ...values, images: refs });
  const by = { chatId: turn.chatId, turnId: turn.id, createdBy: turn.createdBy };
  await imagesRepo.insert(
    tx,
    rows.map((row) => ({ ...row, ...by })),
  );
  return turn;
}

/** The turn's spec with its message's images, when it has any (the runner fetches them before the start). */
export function withImages(spec: TurnSpec, turn: Pick<ChatTurn, 'images'>): TurnSpec {
  const images = imagesOf(turn);
  return images.length === 0 ? spec : { ...spec, images };
}

/** One image of the chat, for its people; undefined for none such. */
export const chatImage = (t: TenantDb, chatId: string, imageId: string): Promise<ChatImage | undefined> =>
  imagesRepo.ofChat(t, chatId, imageId);

/** One image of a turn on the runner's own machine, for that runner; undefined for none such. */
export async function runnerImage(
  db: DbHandle,
  runner: { readonly companyId: string; readonly machineId: string },
  turnId: string,
  imageId: string,
): Promise<ChatImage | undefined> {
  const t = await tenant(db, runner.companyId);
  return imagesRepo.forRunner(t, { turnId, imageId, machineId: runner.machineId });
}
