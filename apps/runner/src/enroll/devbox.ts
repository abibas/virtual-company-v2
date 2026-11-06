import { DEVBOX_KEEPALIVE_BIN } from '../hold/driver.ts';
import type { Host } from '../install/host.ts';

/**
 * Whether this machine is an Airia devbox, and which: a box has the company's `devbox-keepalive` and is a Google
 * Compute Engine instance, whose metadata server names it. Only a machine with the keepalive asks the metadata server
 * (three requests in parallel, a second at most), so no other machine waits for it.
 */

export const METADATA_BASE = 'http://metadata.google.internal/computeMetadata/v1/';
export const METADATA_PATHS = {
  instance: 'instance/name',
  zone: 'instance/zone',
  project: 'project/project-id',
};
export const METADATA_TIMEOUT_MS = 1000;

/** The devbox's place in Google Cloud (`providerRef` of a machine with the `airia_devbox` provider). */
export interface DevboxRef {
  readonly instance: string;
  readonly zone: string;
  readonly project: string;
}

/** What powers the machine: the Airia devbox with its place, or nothing. */
export type Provider =
  | { readonly provider: 'airia_devbox'; readonly providerRef: DevboxRef }
  | { readonly provider: 'none'; readonly providerRef: null };

export const NO_PROVIDER: Provider = { provider: 'none', providerRef: null };

/** One metadata value as text, or undefined when the server does not answer it in time. */
async function metadata(host: Host, path: string): Promise<string | undefined> {
  try {
    const res = await host.fetch(`${METADATA_BASE}${path}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    const text = (await res.text()).trim();
    return res.ok && text !== '' ? text : undefined;
  } catch {
    return undefined;
  }
}

/** The Airia devbox this runner is on (its zone without `projects/<n>/zones/`), or no provider. */
export async function detectProvider(host: Host): Promise<Provider> {
  if (!host.fs.exists(DEVBOX_KEEPALIVE_BIN)) return NO_PROVIDER;
  const [instance, zone, project] = await Promise.all([
    metadata(host, METADATA_PATHS.instance),
    metadata(host, METADATA_PATHS.zone),
    metadata(host, METADATA_PATHS.project),
  ]);
  if (!instance || !zone || !project) return NO_PROVIDER;
  return {
    provider: 'airia_devbox',
    providerRef: { instance, zone: zone.split('/').at(-1) as string, project },
  };
}
