/**
 * A chat message's images in tests (T-18): a message sent with images (base64, as the web sends them), one image read
 * by a person or by a runner with its key, and the rows a message's images leave.
 */
import { chatImages, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { ChatTurnDelivery } from '@mwc/shared/enums';
import { runnerTurnImagePath } from '@mwc/shared/runner-protocol';
import { asc, eq } from 'drizzle-orm';
import type { MachinesWorld } from '../machines/world.ts';
import { as } from '../members/members.ts';
import { bearer, type Person } from '../platform/auth.ts';
import { chatPath, type Scene } from './world.ts';

export const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** Sends a message with images (raw base64 strings are sent as they are), as the owner unless `person` is given. */
export const sendImages = (
  w: MachinesWorld,
  s: Pick<Scene, 'company' | 'chat'>,
  prompt: string,
  images: readonly (Uint8Array | string)[],
  options: { readonly delivery?: ChatTurnDelivery; readonly person?: Person } = {},
) =>
  as(w, options.person ?? s.company.owner)('POST', chatPath(s.company, s.chat.id, '/turns'), {
    prompt,
    images: images.map((image) => ({ data: typeof image === 'string' ? image : base64(image) })),
    ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
  });

/** A response with its bytes, its headers, and its JSON body when it has one. */
async function read(res: Response) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const json = res.headers.get('content-type')?.startsWith('application/json');
  return {
    status: res.status,
    bytes,
    headers: res.headers,
    body: json ? (JSON.parse(new TextDecoder().decode(bytes)) as { error: { code: string } }) : null,
  };
}

/** `GET …/chats/{chatId}/images/{imageId}` as `person` (the owner by default). */
export async function getImage(
  w: MachinesWorld,
  s: Pick<Scene, 'company' | 'chat'>,
  imageId: string,
  person?: Person,
  chatId = s.chat.id,
) {
  const who = person ?? s.company.owner;
  const res = await w.t.app.request(chatPath(s.company, chatId, `/images/${imageId}`), {
    headers: bearer(`fake:${who.subject}`),
  });
  return read(res);
}

/** `GET /api/runner/turns/{turnId}/images/{imageId}` with a runner key (none: no header). */
export async function runnerGetImage(
  w: MachinesWorld,
  key: string | undefined,
  turnId: string,
  imageId: string,
) {
  const headers: Record<string, string> = key === undefined ? {} : { authorization: `Bearer ${key}` };
  return read(await w.t.app.request(runnerTurnImagePath(turnId, imageId), { headers }));
}

/** The images stored for a turn, in order. */
export const imageRows = (db: DbHandle, turnId: string) =>
  rawDb(db).select().from(chatImages).where(eq(chatImages.turnId, turnId)).orderBy(asc(chatImages.position));
