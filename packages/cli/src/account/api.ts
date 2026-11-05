/** `GET /api/me` with a personal API key (`api/client.ts`): who the key acts as, and in which company. */
import { type ApiFailure, apiGet, type Fetch, isObject } from '../api/client.ts';

export type { Fetch } from '../api/client.ts';

/** One company of the caller, as `GET /api/me` lists it (an API key sees its own company only). */
export interface MeMembership {
  readonly companyId: string;
  readonly slug: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
}

/** The part of `GET /api/me` the commands read. */
export interface Me {
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly memberships: readonly MeMembership[];
  readonly session: { readonly via: string };
}

export type MeResult = { readonly ok: true; readonly me: Me } | ApiFailure;

function isMe(body: unknown): body is Me {
  return (
    isObject(body) &&
    isObject(body.user) &&
    typeof body.user.id === 'string' &&
    Array.isArray(body.memberships) &&
    body.memberships.every(
      (m) => isObject(m) && typeof m.companyId === 'string' && typeof m.slug === 'string',
    ) &&
    isObject(body.session)
  );
}

/** `GET <server>/api/me` with the key as the bearer: who it acts as, and in which company. */
export async function getMe(fetch: Fetch, server: string, key: string): Promise<MeResult> {
  const result = await apiGet(fetch, server, key, '/api/me', isMe);
  return result.ok ? { ok: true, me: result.body } : result;
}
