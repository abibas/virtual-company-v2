import { useContext } from 'react';
import type { Api } from '../client.ts';
import { ApiContext } from '../context.ts';
import { call } from '../errors.ts';
import { clearImage, imageFile, objectUrlOf, primeImage, useVersionedImage } from './store.ts';

/**
 * Machine logos on screen, from the shared image store (`store.ts`): the card and the home board share one fetch and
 * one URL per machine's version.
 */

const keyOf = (companyId: string, machineId: string) => `machine:${companyId}:${machineId}`;
const logoRoute = (api: Api) => api.api.companies[':companyId'].machines[':machineId'].logo;

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
  const param = { companyId, machineId };
  const fetch =
    api && version && (async () => objectUrlOf(await logoRoute(api).$get({ param, query: { v: version } })));
  return useVersionedImage(keyOf(companyId, machineId), version, fetch || undefined);
}

/** `PUT .../machines/:machineId/logo` with the prepared bytes; the new version shows at once. */
export async function uploadMachineLogo(api: Api, companyId: string, machineId: string, blob: Blob) {
  const { logo } = await call(
    logoRoute(api).$put({ param: { companyId, machineId }, form: { file: imageFile(blob, 'logo') } }),
  );
  primeImage(keyOf(companyId, machineId), logo.version, blob);
  return logo;
}

/** `DELETE .../machines/:machineId/logo`; the machine shows its kind icon at once. */
export async function removeMachineLogo(api: Api, companyId: string, machineId: string): Promise<void> {
  await call(logoRoute(api).$delete({ param: { companyId, machineId } }));
  clearImage(keyOf(companyId, machineId));
}
