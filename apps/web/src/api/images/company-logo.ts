import { useContext } from 'react';
import type { Api } from '../client.ts';
import { ApiContext } from '../context.ts';
import { call } from '../errors.ts';
import { clearImage, imageFile, objectUrlOf, primeImage, useVersionedImage } from './store.ts';

/** Company logos on screen, from the shared image store (`store.ts`): one fetch and one URL per company's version. */

const keyOf = (companyId: string) => `company:${companyId}`;
const logoRoute = (api: Api) => api.api.companies[':companyId'].logo;

/**
 * The company's logo as an object URL, or null while it loads, when it has none (`version` null) or when it could
 * not be fetched. Keyed by company and version: a new version is fetched once and shared. Without an API client (the
 * design gallery) only primed logos show.
 */
export function useCompanyLogo(companyId: string, version: string | null | undefined): string | null {
  const api = useContext(ApiContext);
  const fetch =
    api &&
    version &&
    (async () => objectUrlOf(await logoRoute(api).$get({ param: { companyId }, query: { v: version } })));
  return useVersionedImage(keyOf(companyId), version, fetch || undefined);
}

/** Shows `blob` as the company's logo at `version` at once, without a fetch (after an upload, or in the gallery). */
export function primeCompanyLogo(companyId: string, version: string, blob: Blob): void {
  primeImage(keyOf(companyId), version, blob);
}

/** `PUT /api/companies/:companyId/logo` with the prepared bytes; the new version shows at once. */
export async function uploadCompanyLogo(api: Api, companyId: string, blob: Blob) {
  const { logo } = await call(
    logoRoute(api).$put({ param: { companyId }, form: { file: imageFile(blob, 'logo') } }),
  );
  primeCompanyLogo(companyId, logo.version, blob);
  return logo;
}

/** `DELETE /api/companies/:companyId/logo`; the company shows its initials at once. */
export async function removeCompanyLogo(api: Api, companyId: string): Promise<void> {
  await call(logoRoute(api).$delete({ param: { companyId } }));
  clearImage(keyOf(companyId));
}
