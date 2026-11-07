/**
 * The machines API as `mwc machine` calls it: a one-time enrollment token
 * (`POST /api/companies/:companyId/machines/enrollment-tokens`, S4.2) and the public configuration (`GET /api/config`),
 * whose `apiUrl` is the API's own address (its port is the devbox's tunnel port). The shapes mirror the server's
 * schemas without importing it.
 */
import { type ApiResult, apiCall, type Fetch, isObject } from './client.ts';

/** A one-time token that enrolls one machine before `expiresAt`; shown once. */
export interface EnrollmentToken {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: string;
}

/** What `mwc machine` needs of the public configuration. */
export interface PublicConfig {
  /** The server's own idea of its address (MWC_PUBLIC_URL, else localhost and its port). */
  readonly apiUrl: string;
}

const isToken = (body: unknown): body is EnrollmentToken =>
  isObject(body) &&
  typeof body.id === 'string' &&
  typeof body.token === 'string' &&
  typeof body.expiresAt === 'string';

const isConfig = (body: unknown): body is { apiUrl: string } =>
  isObject(body) && typeof body.apiUrl === 'string';

/** `POST /api/companies/:companyId/machines/enrollment-tokens` (admins and owners): a new token. */
export function createEnrollmentToken(
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
): Promise<ApiResult<EnrollmentToken>> {
  const path = `/api/companies/${encodeURIComponent(companyId)}/machines/enrollment-tokens`;
  return apiCall(fetch, server, key, path, isToken, { method: 'POST', status: 201 });
}

/** `GET /api/config`: the server's own address. */
export async function getPublicConfig(
  fetch: Fetch,
  server: string,
  key: string,
): Promise<ApiResult<PublicConfig>> {
  const result = await apiCall(fetch, server, key, '/api/config', isConfig);
  if (!result.ok) return result;
  return { ok: true, body: { apiUrl: result.body.apiUrl } };
}
