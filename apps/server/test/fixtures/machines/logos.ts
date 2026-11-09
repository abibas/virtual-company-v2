/**
 * The machine logo tests' helpers: `PUT`, `GET` and `DELETE .../machines/:machineId/logo` as a token's holder (the
 * images and the form are the company logo's, `fixtures/companies/logos.ts`), and the raw row a logo leaves behind.
 */
import { type DbHandle, machineLogos } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { logoForm, type Upload } from '../companies/logos.ts';
import type { AuthWorld } from '../platform/auth.ts';
import { bearer } from '../platform/auth.ts';

export const machineLogoPath = (companyId: string, machineId: string, query = '') =>
  `/api/companies/${companyId}/machines/${machineId}/logo${query}`;

const headersOf = (token: string | undefined, extra: Record<string, string> = {}) => ({
  ...(token === undefined ? {} : bearer(token)),
  ...extra,
});

async function jsonOf(res: Response) {
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

/** `PUT .../logo` with a body as given (a form from an upload by default), as the holder of `token`. */
export async function putMachineLogo(
  w: AuthWorld,
  token: string | undefined,
  path: { companyId: string; machineId: string },
  body: Upload | NonNullable<RequestInit['body']>,
  headers: Record<string, string> = {},
) {
  const isUpload = (value: typeof body): value is Upload => (value as Upload).bytes instanceof Uint8Array;
  const res = await w.t.app.request(machineLogoPath(path.companyId, path.machineId), {
    method: 'PUT',
    body: isUpload(body) ? logoForm(body) : body,
    headers: headersOf(token, headers),
  });
  return jsonOf(res);
}

/** `GET .../logo` as the holder of `token`, with the bytes. */
export async function getMachineLogo(
  w: AuthWorld,
  token: string | undefined,
  path: { companyId: string; machineId: string },
  options: { v?: string; ifNoneMatch?: string } = {},
) {
  const query = options.v === undefined ? '' : `?v=${options.v}`;
  const extra = options.ifNoneMatch === undefined ? {} : { 'if-none-match': options.ifNoneMatch };
  const res = await w.t.app.request(machineLogoPath(path.companyId, path.machineId, query), {
    headers: headersOf(token, extra),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const body = res.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : null;
  return { status: res.status, bytes, body, headers: res.headers };
}

/** `DELETE .../logo` as the holder of `token`. */
export async function deleteMachineLogo(
  w: AuthWorld,
  token: string | undefined,
  path: { companyId: string; machineId: string },
) {
  const res = await w.t.app.request(machineLogoPath(path.companyId, path.machineId), {
    method: 'DELETE',
    headers: headersOf(token),
  });
  return jsonOf(res);
}

export const machineLogoRow = async (db: DbHandle, machineId: string) =>
  (await rawDb(db).select().from(machineLogos).where(eq(machineLogos.machineId, machineId)))[0];
