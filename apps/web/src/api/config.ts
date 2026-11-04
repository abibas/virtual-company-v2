import { createContext, useContext } from 'react';
import { publicApi } from './client.ts';
import { call } from './errors.ts';
import type { PublicConfig } from './types.ts';

/** `GET /api/config`: how people sign in on this server, read at boot (never baked into the build). */
export function fetchPublicConfig(): Promise<PublicConfig> {
  return call(publicApi.api.config.$get());
}

/** The configuration read at boot, for the pages that show the server's address. */
export const PublicConfigContext = createContext<PublicConfig | null>(null);

export function usePublicConfig(): PublicConfig {
  const config = useContext(PublicConfigContext);
  if (config === null) throw new Error('usePublicConfig() is used before the boot read the configuration');
  return config;
}
