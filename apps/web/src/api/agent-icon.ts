import { useContext, useEffect, useSyncExternalStore } from 'react';
import type { Api } from './client.ts';
import { ApiContext } from './context.ts';
import { call } from './errors.ts';
import type { AgentIconChoice } from './types.ts';

/**
 * Agents' icon images on screen, as machine logos are (`machine-logo.ts`): the API takes a bearer token only, so the
 * bytes are fetched through the client and shown from an object URL. One entry per agent holds the URL of its current
 * version; a new version replaces it and the old URL is revoked, so every place that shows the agent shares one fetch.
 */

interface Entry {
  readonly version: string;
  /** The object URL once loaded; null when the fetch failed or found none; undefined while it loads. */
  url: string | null | undefined;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const keyOf = (companyId: string, agentId: string) => `${companyId}:${agentId}`;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Puts `entry` in the agent's place, revoking the URL of the one it replaces. */
function replace(key: string, entry: Entry | undefined) {
  const previous = entries.get(key);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  if (entry) entries.set(key, entry);
  else entries.delete(key);
  notify();
}

const iconRoute = (api: Api) => api.api.companies[':companyId'].agents[':agentId'].icon;

async function fetchIcon(api: Api, companyId: string, agentId: string, version: string) {
  const response = await iconRoute(api).$get({ param: { companyId, agentId }, query: { v: version } });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

/**
 * The agent's icon image as an object URL, or null while it loads, when its icon is not an image (`version` null or
 * undefined) or when it could not be fetched. Keyed by agent and version: a new version is fetched once and shared.
 */
export function useAgentIconImage(
  companyId: string | undefined,
  agentId: string,
  version: string | null | undefined,
): string | null {
  const api = useContext(ApiContext);
  const key = keyOf(companyId ?? '', agentId);
  const url = useSyncExternalStore(subscribe, () => {
    const entry = entries.get(key);
    return entry && entry.version === version ? (entry.url ?? null) : null;
  });
  useEffect(() => {
    // An image of another version, or none: the next version is fetched; none leaves the shared entry alone.
    if (!version || !companyId || !api || entries.get(key)?.version === version) return;
    const next: Entry = { version, url: undefined };
    replace(key, next);
    fetchIcon(api, companyId, agentId, version)
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
  }, [api, key, companyId, agentId, version]);
  return url;
}

/** The icon file as the server takes it: the prepared bytes, named by their type. */
function iconFile(blob: Blob): File {
  return new File([blob], blob.type === 'image/webp' ? 'icon.webp' : 'icon.png', { type: blob.type });
}

/** Changing an agent's icon (admins and owners): upload an image, choose the face or an emoji. */
export function agentIconCalls(api: Api, companyId: string) {
  const route = iconRoute(api);
  return {
    /** `PUT .../icon` with the prepared bytes; the new version shows at once. */
    async upload(agentId: string, blob: Blob) {
      const { icon } = await call(
        route.$put({ param: { companyId, agentId }, form: { file: iconFile(blob) } }),
      );
      if (icon.kind === 'image') {
        replace(keyOf(companyId, agentId), { version: icon.version, url: URL.createObjectURL(blob) });
      }
      return icon;
    },
    /** `PATCH .../icon`: the drawn face, or one emoji; any image goes. */
    async choose(agentId: string, choice: AgentIconChoice) {
      const { icon } = await call(route.$patch({ param: { companyId, agentId }, json: choice }));
      replace(keyOf(companyId, agentId), undefined);
      return icon;
    },
  };
}

export type AgentIconCalls = ReturnType<typeof agentIconCalls>;
