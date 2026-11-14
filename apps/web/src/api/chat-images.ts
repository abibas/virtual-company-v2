import { useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Api } from './client.ts';
import { ApiContext } from './context.ts';
import { ApiError } from './errors.ts';
import { listenerSet } from './images/store.ts';
import type { ChatTurnWithEvents } from './types.ts';

/**
 * A chat message's images (T-18, `GET …/chats/{chatId}/images/{imageId}`): what a message sends of them (base64, with
 * its prompt), and an image's bytes on screen. The route takes a bearer token only, so the bytes are fetched through the
 * client and shown from an object URL; an image never changes, so its URL is kept by its id for this page load and
 * shared by its thumbnail and its large view.
 */

/** One image as its turn names it. */
export type ChatImage = ChatTurnWithEvents['images'][number];

/** The bytes of `blob` as plain base64 (the standard alphabet, padded, no `data:` prefix). */
export function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read'));
    reader.readAsDataURL(blob);
  });
}

/** The images of a message as the turn's body takes them, in order. */
export async function imagesBody(images: readonly Blob[]): Promise<{ data: string }[]> {
  return Promise.all(images.map(async (image) => ({ data: await base64Of(image) })));
}

/** An image's bytes, as the server keeps them (its type on the blob). */
export async function chatImageBytes(
  api: Api,
  companyId: string,
  chatId: string,
  imageId: string,
): Promise<Blob> {
  const response = await api.api.companies[':companyId'].chats[':chatId'].images[':imageId'].$get({
    param: { companyId, chatId, imageId },
  });
  if (!response.ok) throw new ApiError(response.status, 'image_not_found', 'The image could not be read');
  return response.blob();
}

/** An object URL by image id: undefined while it loads, null when it failed. */
const urls = new Map<string, string | null>();
const loading = new Set<string>();
const { notify, subscribe } = listenerSet();

/** Forgets an image that failed, so the next look fetches it again. */
export function retryChatImage(imageId: string): void {
  if (urls.get(imageId) !== null) return;
  urls.delete(imageId);
  notify();
}

/**
 * The image as an object URL, fetched once for this page load: undefined while it loads (or without an API client or a
 * company: the design gallery), null when it could not be read.
 */
export function useChatImageUrl(
  companyId: string | undefined,
  chatId: string,
  imageId: string,
): string | null | undefined {
  const api = useContext(ApiContext);
  const url = useSyncExternalStore(subscribe, () => urls.get(imageId));
  const where = useRef({ api, companyId, chatId });
  where.current = { api, companyId, chatId };
  const canFetch = api !== null && companyId !== undefined;
  useEffect(() => {
    if (url !== undefined || !canFetch || loading.has(imageId)) return;
    const { api: client, companyId: company, chatId: chat } = where.current;
    if (client === null || company === undefined) return;
    loading.add(imageId);
    chatImageBytes(client, company, chat, imageId)
      .then(
        (blob) => URL.createObjectURL(blob),
        () => null,
      )
      .then((made) => {
        loading.delete(imageId);
        urls.set(imageId, made);
        notify();
      });
  }, [imageId, url, canFetch]);
  return url;
}
