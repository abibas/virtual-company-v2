/** What a bearer token is, by its shape: an API key, a run token (S4) or a session token. */
export type BearerKind = 'api_key' | 'run_token' | 'session';

/** The token of `Authorization: Bearer <token>` (the scheme in any case), or null for anything else. */
export function readBearer(header: string | undefined): string | null {
  const match = /^Bearer +(\S+) *$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/** A JWT whose payload says `typ: 'run'`: the run tokens S4 signs (`{ typ, cid, rid, aid, exp }`). */
function isRunToken(token: string): boolean {
  const payload = token.split('.');
  if (payload.length !== 3) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && (claims as { typ?: unknown }).typ === 'run';
  } catch {
    return false;
  }
}

/**
 * Sorts a bearer token by its shape, without verifying it: `mwc_...` is an API key, a JWT with `typ: 'run'` a
 * run token, anything else goes to the identity provider as a session token.
 */
export function classifyBearer(token: string): BearerKind {
  if (token.startsWith('mwc_')) return 'api_key';
  return isRunToken(token) ? 'run_token' : 'session';
}
