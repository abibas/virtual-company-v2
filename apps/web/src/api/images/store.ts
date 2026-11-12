import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Images on screen that the API serves (company and machine logos, agents' icons). The API takes a bearer token only,
 * so an `<img src="/api/...">` cannot show one: the bytes are fetched through the client and shown from an object URL.
 * One entry per key (`company:<id>`, `machine:<company>:<id>`, ...) holds the URL of its current version; a new version
 * replaces it and the old URL is revoked, so every component showing the same image shares one fetch and one URL.
 */

/** A set of listeners for `useSyncExternalStore`: `notify` calls each one. */
export function listenerSet() {
  const listeners = new Set<() => void>();
  return {
    notify(): void {
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface Entry {
  readonly version: string;
  /** The object URL once loaded; null when the fetch failed or found none; undefined while it loads. */
  url: string | null | undefined;
}

const entries = new Map<string, Entry>();
const { notify, subscribe } = listenerSet();

/** Puts `entry` in the key's place, revoking the URL of the one it replaces; undefined clears it. */
function replace(key: string, entry: Entry | undefined): void {
  const previous = entries.get(key);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  if (entry) entries.set(key, entry);
  else entries.delete(key);
  notify();
}

/** Shows `blob` as the key's image at `version` at once, without a fetch (after an upload, or in the gallery). */
export function primeImage(key: string, version: string, blob: Blob): void {
  replace(key, { version, url: URL.createObjectURL(blob) });
}

/** Forgets the key's image (it has none now), revoking its URL. */
export function clearImage(key: string): void {
  replace(key, undefined);
}

/** The bytes of a response as an object URL, or null when it failed. */
export async function objectUrlOf(response: {
  readonly ok: boolean;
  blob(): Promise<Blob>;
}): Promise<string | null> {
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

/** Loads the key's image at `version`, unless something replaces its entry meanwhile. */
function load(key: string, version: string, fetch: () => Promise<string | null>): void {
  const next: Entry = { version, url: undefined };
  replace(key, next);
  fetch()
    .catch(() => null)
    .then((loaded) => {
      // Only if nothing replaced this entry meanwhile (a newer version, a primed upload).
      if (entries.get(key) !== next) {
        if (loaded) URL.revokeObjectURL(loaded);
        return;
      }
      next.url = loaded;
      notify();
    });
}

/**
 * The key's image at `version` as an object URL, or null while it loads, when there is none (`version` null or
 * undefined) or when it could not be fetched. A new version is fetched once with `fetch` and shared; without `fetch`
 * (no API client) only primed images show. No version clears the key's entry, unless `keepWhenNone` (a caller that
 * may not know the version yet leaves the shared entry alone).
 */
export function useVersionedImage(
  key: string,
  version: string | null | undefined,
  fetch: (() => Promise<string | null>) | undefined,
  options: { readonly keepWhenNone?: boolean } = {},
): string | null {
  const latest = useRef(fetch);
  latest.current = fetch;
  const canFetch = fetch !== undefined;
  const keepWhenNone = options.keepWhenNone === true;
  const url = useSyncExternalStore(subscribe, () => {
    const entry = entries.get(key);
    return entry && entry.version === version ? (entry.url ?? null) : null;
  });
  useEffect(() => {
    const entry = entries.get(key);
    if (!version) {
      if (entry && !keepWhenNone) replace(key, undefined);
      return;
    }
    const fetchNow = latest.current;
    if (entry?.version === version || !canFetch || fetchNow === undefined) return;
    load(key, version, fetchNow);
  }, [key, version, canFetch, keepWhenNone]);
  return url;
}

/** An image file as the server takes it: the prepared bytes, named `<name>.webp` or `<name>.png` by their type. */
export function imageFile(blob: Blob, name: string): File {
  return new File([blob], blob.type === 'image/webp' ? `${name}.webp` : `${name}.png`, { type: blob.type });
}
