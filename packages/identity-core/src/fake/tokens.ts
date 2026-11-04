import type { VerifiedIdentity } from '@mwc/shared/identity';
import { IdentityProviderError } from '../errors.ts';
import type { VerifyTokenContext } from '../provider.ts';

/** Allowed clock difference for `exp` and `nbf`, as Clerk's verification allows. */
export const FAKE_CLOCK_SKEW_MS = 5_000;

/**
 * What a fake token says: `fake:<subject>` followed by optional `;`-separated parts in any order:
 * `org=<externalId>` (the active organization, a hint), `pending` (Clerk `sts=pending`), `sid=<id>` (the
 * session; `sess_<subject>` by default), `iss=<issuer>`, `azp=<origin>`, `exp=<ms>` and `nbf=<ms>` (epoch
 * milliseconds). A token without `iss`, `azp`, `exp` or `nbf` is not checked for them.
 */
export interface FakeToken {
  readonly subject: string;
  readonly org?: string;
  readonly pending: boolean;
  readonly sessionId?: string;
  readonly issuer?: string;
  readonly authorizedParty?: string;
  readonly expiresAt?: number;
  readonly notBefore?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const unauthorized = (message: string) => new IdentityProviderError('unauthorized', `fake: ${message}`);

const TEXT_PARTS = { org: 'org', sid: 'sessionId', iss: 'issuer', azp: 'authorizedParty' } as const;
const TIME_PARTS = { exp: 'expiresAt', nbf: 'notBefore' } as const;

function readPart(token: Mutable<FakeToken>, part: string): void {
  if (part === 'pending') {
    token.pending = true;
    return;
  }
  const at = part.indexOf('=');
  const name = at < 0 ? part : part.slice(0, at);
  const value = at < 0 ? '' : part.slice(at + 1);
  if (value !== '' && Object.hasOwn(TEXT_PARTS, name)) {
    token[TEXT_PARTS[name as keyof typeof TEXT_PARTS]] = value;
  } else if (/^\d+$/.test(value) && Object.hasOwn(TIME_PARTS, name)) {
    token[TIME_PARTS[name as keyof typeof TIME_PARTS]] = Number(value);
  } else {
    throw unauthorized(`unknown token part "${part}"`);
  }
}

/** Reads a fake token; anything else rejects as `unauthorized`, like a bad or foreign token would. */
export function parseFakeToken(token: string): FakeToken {
  if (!token.startsWith('fake:')) throw unauthorized('not a fake token');
  const [subject = '', ...parts] = token.slice('fake:'.length).split(';');
  const parsed: Mutable<FakeToken> = { subject, pending: false };
  for (const part of parts) readPart(parsed, part);
  return parsed;
}

export interface FakeVerifier {
  /** The fake provider's issuer: a token naming another one is refused. */
  readonly issuer: string;
  /** Now, in epoch milliseconds (the provider's clock). */
  readonly now: number;
  /** Whether a user with this subject exists (and is not deleted). */
  exists(subject: string): boolean;
}

/**
 * Verifies a fake token the way Clerk verifies a session token: the issuer, the authorized party (`azp`
 * must be one of `ctx.authorizedParties` when both are given), `exp` and `nbf` with 5 seconds of skew, and
 * that the user exists. Every refusal is `unauthorized`.
 */
export function verifyFakeToken(
  token: string,
  ctx: VerifyTokenContext,
  verifier: FakeVerifier,
): VerifiedIdentity {
  const parsed = parseFakeToken(token);
  if (parsed.issuer !== undefined && parsed.issuer !== verifier.issuer)
    throw unauthorized('token from another issuer');
  const parties = ctx.authorizedParties;
  if (parsed.authorizedParty !== undefined && parties.length > 0 && !parties.includes(parsed.authorizedParty))
    throw unauthorized('token for another origin');
  if (parsed.expiresAt !== undefined && verifier.now > parsed.expiresAt + FAKE_CLOCK_SKEW_MS)
    throw unauthorized('token expired');
  if (parsed.notBefore !== undefined && verifier.now < parsed.notBefore - FAKE_CLOCK_SKEW_MS)
    throw unauthorized('token not active yet');
  if (!verifier.exists(parsed.subject)) throw unauthorized('no such user');
  return {
    issuer: verifier.issuer,
    subject: parsed.subject,
    sessionId: parsed.sessionId ?? `sess_${parsed.subject}`,
    pending: parsed.pending,
    ...(parsed.org === undefined ? {} : { activeOrgExternalId: parsed.org }),
  };
}
