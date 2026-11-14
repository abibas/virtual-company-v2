import type { TurnStart } from '@mwc/shared/runner-protocol';
import { type FetchedImage, fetchImages, type ImageFetch } from './images.ts';
import type { HarnessHost } from './turns.ts';

/** What a start waited for gave: the message's images fetched, or the refusal that ends the turn before it starts. */
export interface BeforeStart {
  readonly refused?: string;
  readonly images: readonly FetchedImage[];
}

/**
 * What a turn's start waits for (`turns.ts`), if anything: a harness missing at start looked for again (it may have been
 * installed since), then a container's missing home folder made (once the harness is there), then the message's images
 * fetched from the server (T-18, `images.ts`; none when the harness is still missing, the start is refused anyway).
 * Undefined when there is nothing to wait for; the promise never rejects.
 */
export function beforeStart(
  host: HarnessHost,
  fetch: ImageFetch | undefined,
  frame: TurnStart,
): Promise<BeforeStart> | undefined {
  const { harness, cwd } = frame.spec;
  const refs = frame.spec.images ?? [];
  const search = host.findAgain !== undefined && host.drivers[harness] === undefined;
  const makeHome = host.makeHome?.bind(host);
  const runs = search || host.drivers[harness] !== undefined;
  const make = makeHome !== undefined && runs && !host.isDirectory(cwd);
  if (!search && !make && refs.length === 0) return undefined;
  return (async () => {
    if (search) await host.findAgain?.(harness);
    if (make && host.drivers[harness] !== undefined) await makeHome(cwd);
    if (refs.length === 0 || host.drivers[harness] === undefined) return { images: [] };
    const fetched = await fetchImages(fetch, frame.turnId, refs);
    return 'refused' in fetched ? { refused: fetched.refused, images: [] } : fetched;
  })();
}
