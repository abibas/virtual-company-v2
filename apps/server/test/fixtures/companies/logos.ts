/**
 * The logo tests' helpers: tiny real images (a 1×1 PNG, JPEG, WebP and GIF, and an SVG), uploads as the web's typed
 * client sends them (a multipart form with one `file`), reads of the logo, and the raw rows a logo leaves behind.
 */
import { createHash } from 'node:crypto';
import { auditLog, companyLogos, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq } from 'drizzle-orm';
import type { AuthWorld } from '../platform/auth.ts';
import { bearer } from '../platform/auth.ts';

const image = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'));

export const PNG = image(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
);
export const JPEG = image(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
);
export const WEBP = image('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');
export const GIF = image('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
export const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>',
);

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A PNG signature followed by zeros, `size` bytes long. */
export function pngOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG.subarray(0, 8));
  return bytes;
}

export const logoPath = (companyId: string, query = '') => `/api/companies/${companyId}/logo${query}`;

export interface Upload {
  readonly bytes: Uint8Array;
  /** The file name the form declares (never trusted). */
  readonly name?: string;
  /** The type the form declares (never trusted). */
  readonly type?: string;
}

/** The form `$put({ param, form: { file } })` sends. */
export function logoForm(upload: Upload): FormData {
  const form = new FormData();
  const file = new File([upload.bytes], upload.name ?? 'logo.png', { type: upload.type ?? 'image/png' });
  form.append('file', file);
  return form;
}

/** `PUT .../logo` with a body as given (a form by default), as the holder of `token` (none: no credential). */
export async function putLogo(
  w: AuthWorld,
  token: string | undefined,
  companyId: string,
  body: Upload | NonNullable<RequestInit['body']>,
  options: { requestId?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    ...(token === undefined ? {} : bearer(token)),
    ...(options.requestId === undefined ? {} : { 'x-request-id': options.requestId }),
    ...options.headers,
  };
  const isUpload = (value: typeof body): value is Upload => (value as Upload).bytes instanceof Uint8Array;
  const form = isUpload(body) ? logoForm(body) : body;
  const res = await w.t.app.request(logoPath(companyId), { method: 'PUT', body: form, headers });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text), headers: res.headers };
}

/** `GET .../logo` as the holder of `token`, with the bytes. */
export async function getLogo(
  w: AuthWorld,
  token: string | undefined,
  companyId: string,
  options: { v?: string; ifNoneMatch?: string } = {},
) {
  const headers: Record<string, string> = {
    ...(token === undefined ? {} : bearer(token)),
    ...(options.ifNoneMatch === undefined ? {} : { 'if-none-match': options.ifNoneMatch }),
  };
  const query = options.v === undefined ? '' : `?v=${options.v}`;
  const res = await w.t.app.request(logoPath(companyId, query), { headers });
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
}

/** `DELETE .../logo` as the holder of `token`. */
export async function deleteLogo(
  w: AuthWorld,
  token: string | undefined,
  companyId: string,
  requestId?: string,
) {
  const headers: Record<string, string> = {
    ...(token === undefined ? {} : bearer(token)),
    ...(requestId === undefined ? {} : { 'x-request-id': requestId }),
  };
  const res = await w.t.app.request(logoPath(companyId), { method: 'DELETE', headers });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

export const logoRow = async (db: DbHandle, companyId: string) =>
  (await rawDb(db).select().from(companyLogos).where(eq(companyLogos.companyId, companyId)))[0];

/** The company's audit rows of its `logo` field, oldest first, without their ids and times. */
export async function logoAudit(db: DbHandle, companyId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.field, 'logo')))
    .orderBy(asc(auditLog.id));
  return rows.map(({ id: _id, createdAt: _at, ...row }) => row);
}
