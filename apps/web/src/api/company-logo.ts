import { useContext, useEffect, useSyncExternalStore } from 'react';
import type { Api } from './client.ts';
import { ApiContext } from './context.ts';
import { call } from './errors.ts';

/**
 * Company logos on screen. The API takes a bearer token only, so an `<img src="/api/...">` cannot show one: the
 * bytes are fetched through the client and shown from an object URL. One entry per company holds the URL of its
 * current version; a new version replaces it and the old URL is revoked, so every component showing a company
 * shares one fetch and one URL.
 */

interface Entry {
  readonly version: string;
  /** The object URL once loaded; null when the fetch failed or found none; undefined while it loads. */
  url: string | null | undefined;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Puts `entry` in the company's place, revoking the URL of the one it replaces. */
function replace(companyId: string, entry: Entry | undefined) {
  const previous = entries.get(companyId);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  if (entry) entries.set(companyId, entry);
  else entries.delete(companyId);
  notify();
}

async function fetchLogo(api: Api, companyId: string, version: string): Promise<string | null> {
  const response = await api.api.companies[':companyId'].logo.$get({
    param: { companyId },
    query: { v: version },
  });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

/**
 * The company's logo as an object URL, or null while it loads, when it has none (`version` null) or when it could
 * not be fetched. Keyed by company and version: a new version is fetched once and shared. Without an API client (the
 * design gallery) only primed logos show.
 */
export function useCompanyLogo(companyId: string, version: string | null | undefined): string | null {
  const api = useContext(ApiContext);
  const url = useSyncExternalStore(subscribe, () => {
    const entry = entries.get(companyId);
    return entry && entry.version === version ? (entry.url ?? null) : null;
  });
  useEffect(() => {
    const entry = entries.get(companyId);
    if (!version) {
      if (entry) replace(companyId, undefined);
      return;
    }
    if (entry?.version === version || !api) return;
    const next: Entry = { version, url: undefined };
    replace(companyId, next);
    fetchLogo(api, companyId, version)
      .catch(() => null)
      .then((loaded) => {
        // Only if nothing replaced this entry meanwhile (a newer version, a primed upload).
        if (entries.get(companyId) !== next) {
          if (loaded) URL.revokeObjectURL(loaded);
          return;
        }
        next.url = loaded;
        notify();
      });
  }, [api, companyId, version]);
  return url;
}

/** Shows `blob` as the company's logo at `version` at once, without a fetch (after an upload, or in the gallery). */
export function primeCompanyLogo(companyId: string, version: string, blob: Blob): void {
  replace(companyId, { version, url: URL.createObjectURL(blob) });
}

/** The logo file as the server takes it: the prepared bytes, named by their type. */
function logoFile(blob: Blob): File {
  return new File([blob], blob.type === 'image/webp' ? 'logo.webp' : 'logo.png', { type: blob.type });
}

/** `PUT /api/companies/:companyId/logo` with the prepared bytes; the new version shows at once. */
export async function uploadCompanyLogo(api: Api, companyId: string, blob: Blob) {
  const { logo } = await call(
    api.api.companies[':companyId'].logo.$put({ param: { companyId }, form: { file: logoFile(blob) } }),
  );
  primeCompanyLogo(companyId, logo.version, blob);
  return logo;
}

/** `DELETE /api/companies/:companyId/logo`; the company shows its initials at once. */
export async function removeCompanyLogo(api: Api, companyId: string): Promise<void> {
  await call(api.api.companies[':companyId'].logo.$delete({ param: { companyId } }));
  replace(companyId, undefined);
}
