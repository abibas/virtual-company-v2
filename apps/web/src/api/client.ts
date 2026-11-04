import type { AppType } from '@mwc/server';
import { hc } from 'hono/client';

/**
 * The typed API client. `AppType` is a type-only import, so no server code reaches the bundle; the
 * paths and response shapes come from the server's zod-openapi routes. Same origin: Vite proxies
 * /api, /healthz and /readyz to the API in dev and preview, and the server serves the UI in prod.
 */
export const api = hc<AppType>('/');

export type ApiStatus =
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'not_ready'; readonly version: string; readonly reason: string }
  | { readonly kind: 'unreachable' };

/** Asks /api/version and /readyz together and folds the answers into one status for the Home page. */
export async function fetchApiStatus(): Promise<ApiStatus> {
  try {
    const [versionRes, readyRes] = await Promise.all([api.api.version.$get(), api.readyz.$get()]);
    if (!versionRes.ok) return { kind: 'unreachable' };
    const { version } = await versionRes.json();
    if (readyRes.status === 200) return { kind: 'ready', version };
    if (readyRes.status === 503) {
      const { reason } = await readyRes.json();
      return { kind: 'not_ready', version, reason };
    }
    return { kind: 'unreachable' };
  } catch {
    // A network error, or a proxy error page that is not the API's JSON.
    return { kind: 'unreachable' };
  }
}
