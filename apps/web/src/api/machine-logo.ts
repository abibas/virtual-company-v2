import { useContext, useEffect, useSyncExternalStore } from 'react';
import type { Api } from './client.ts';
import { ApiContext } from './context.ts';
import { call } from './errors.ts';

/**
 * Machine logos on screen, as company logos are (`company-logo.ts`): the API takes a bearer token only, so the bytes
 * are fetched through the client and shown from an object URL. One entry per machine holds the URL of its current
 * version; a new version replaces it and the old URL is revoked, so the card and the home board share one fetch.
 */

interface Entry {
  readonly version: string;
  /** The object URL once loaded; null when the fetch failed or found none; undefined while it loads. */
  url: string | null | undefined;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const keyOf = (companyId: string, machineId: string) => `${companyId}:${machineId}`;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Puts `entry` in the machine's place, revoking the URL of the one it replaces. */
function replace(key: string, entry: Entry | undefined) {
  const previous = entries.get(key);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  if (entry) entries.set(key, entry);
  else entries.delete(key);
  notify();
}

async function fetchLogo(api: Api, companyId: string, machineId: string, version: string) {
  const response = await api.api.companies[':companyId'].machines[':machineId'].logo.$get({
    param: { companyId, machineId },
    query: { v: version },
  });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

/**
 * The machine's logo as an object URL, or null while it loads, when it has none (`version` null) or when it could not
 * be fetched. Keyed by machine and version: a new version is fetched once and shared.
 */
export function useMachineLogo(
  companyId: string,
  machineId: string,
  version: string | null | undefined,
): string | null {
  const api = useContext(ApiContext);
  const key = keyOf(companyId, machineId);
  const url = useSyncExternalStore(subscribe, () => {
    const entry = entries.get(key);
    return entry && entry.version === version ? (entry.url ?? null) : null;
  });
  useEffect(() => {
    const entry = entries.get(key);
    if (!version) {
      if (entry) replace(key, undefined);
      return;
    }
    if (entry?.version === version || !api) return;
    const next: Entry = { version, url: undefined };
    replace(key, next);
    fetchLogo(api, companyId, machineId, version)
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
  }, [api, key, companyId, machineId, version]);
  return url;
}

/** The logo file as the server takes it: the prepared bytes, named by their type. */
function logoFile(blob: Blob): File {
  return new File([blob], blob.type === 'image/webp' ? 'logo.webp' : 'logo.png', { type: blob.type });
}

/** `PUT .../machines/:machineId/logo` with the prepared bytes; the new version shows at once. */
export async function uploadMachineLogo(api: Api, companyId: string, machineId: string, blob: Blob) {
  const { logo } = await call(
    api.api.companies[':companyId'].machines[':machineId'].logo.$put({
      param: { companyId, machineId },
      form: { file: logoFile(blob) },
    }),
  );
  replace(keyOf(companyId, machineId), { version: logo.version, url: URL.createObjectURL(blob) });
  return logo;
}

/** `DELETE .../machines/:machineId/logo`; the machine shows its kind icon at once. */
export async function removeMachineLogo(api: Api, companyId: string, machineId: string): Promise<void> {
  await call(
    api.api.companies[':companyId'].machines[':machineId'].logo.$delete({ param: { companyId, machineId } }),
  );
  replace(keyOf(companyId, machineId), undefined);
}
