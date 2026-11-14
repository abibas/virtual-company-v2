import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnImage } from '@mwc/harness-core';
import { CHAT_IMAGE_EXTENSIONS, type ChatImageRef } from '@mwc/shared/chat-images';
import { RUNNER_SHA256_HEADER, runnerTurnImagePath } from '@mwc/shared/runner-protocol';
import { httpBase } from '../install/enroll/enroll.ts';

/**
 * A message's images (T-18, docs/harness.md "Images in a message"): the turn's spec names them, and before the turn
 * starts the runner fetches each one from its server (`GET /api/runner/turns/<turnId>/images/<id>`, with its runner
 * key), checks its size and SHA-256 against the spec, and writes it into the turn's run folder (`images/<n>.<ext>`,
 * 0600, gone with the folder), from where the driver hands it to the harness (Claude Code: base64 blocks on stdin;
 * Codex: `--image <file>`). A turn whose images cannot be fetched is refused `images_unavailable: <why>`.
 */

/** How long each image's download may take. */
export const IMAGE_FETCH_TIMEOUT_MS = 60_000;

/** Fetches one of a turn's images (its bytes, checked); throws with why it could not. */
export type ImageFetch = (turnId: string, image: ChatImageRef) => Promise<Uint8Array>;

/** An image fetched for a turn, before it is written. */
export interface FetchedImage {
  readonly ref: ChatImageRef;
  readonly bytes: Uint8Array;
}

export interface ImageFetchDeps {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The configuration now (`key.rotate` replaces the key). */
  readonly serverUrl: () => string;
  readonly runnerKey: () => string;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The runner's way to fetch a turn's images from its server, each checked against its spec. */
export function imageFetcher(deps: ImageFetchDeps): ImageFetch {
  return async (turnId, image) => {
    const url = `${httpBase(deps.serverUrl())}${runnerTurnImagePath(turnId, image.id)}`;
    const response = await deps.fetch(url, {
      headers: { authorization: `Bearer ${deps.runnerKey()}` },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const said = response.headers.get(RUNNER_SHA256_HEADER);
    if (
      bytes.length !== image.size ||
      sha256(bytes) !== image.sha256 ||
      (said !== null && said !== image.sha256)
    )
      throw new Error('its bytes do not match the turn');
    return bytes;
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Fetches the turn's images in order: all of them, or the refusal that says which one failed and why. */
export async function fetchImages(
  fetch: ImageFetch | undefined,
  turnId: string,
  refs: readonly ChatImageRef[],
): Promise<{ readonly images: FetchedImage[] } | { readonly refused: string }> {
  if (fetch === undefined) return { refused: 'images_unavailable: this runner cannot fetch images' };
  const images: FetchedImage[] = [];
  for (const [i, ref] of refs.entries()) {
    try {
      images.push({ ref, bytes: await fetch(turnId, ref) });
    } catch (error) {
      return { refused: `images_unavailable: image ${i + 1} could not be fetched (${messageOf(error)})` };
    }
  }
  return { images };
}

/** The folder of a turn's images in its run folder. */
export const IMAGES_DIR = 'images';

/**
 * The turn's images in its run folder `runDir` (`images/1.png`, …): what the driver gets of each (its path is known
 * before the folder is made), and `write`, which writes them there, private, once the folder is made.
 */
export function turnImages(runDir: string, fetched: readonly FetchedImage[]) {
  const dir = join(runDir, IMAGES_DIR);
  const files = fetched.map(({ ref, bytes }, i) => ({
    ref,
    bytes,
    path: join(dir, `${i + 1}.${CHAT_IMAGE_EXTENSIONS[ref.contentType]}`),
  }));
  const images: TurnImage[] = files.map(({ ref, bytes, path }) => ({
    contentType: ref.contentType,
    base64: Buffer.from(bytes).toString('base64'),
    path,
  }));
  return {
    /** None for a turn without images. */
    images: images.length === 0 ? undefined : images,
    write(): void {
      if (files.length === 0) return;
      mkdirSync(dir, { mode: 0o700 });
      for (const file of files) writeFileSync(file.path, file.bytes, { mode: 0o600 });
    },
  };
}
