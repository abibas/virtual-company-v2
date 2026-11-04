import { createContext, useContext } from 'react';
import type { Api } from './client.ts';

/** The signed-in API client (`createApi` with Clerk's `getToken`), provided by the Clerk root. */
export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi() is used outside the Clerk root');
  return api;
}
