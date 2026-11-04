import type { TenantDb } from '@mwc/db';
import type { MembershipRole, VerifiedIdentity } from '@mwc/shared/identity';
import type { AppEnv } from '../env.ts';

/** What kind of caller it is. Only people (`user`) sign in today; agents and runners arrive with S3–S4. */
export type ActorKind = 'user' | 'agent' | 'runner' | 'system';

/** How the caller proved it: a Clerk session token, an API key, or a run token (S4). */
export type ActorVia = 'clerk' | 'api_key' | 'run_token';

/**
 * Who is calling, as `authn()` established it from `Authorization: Bearer ...`. Authorization never trusts the
 * identity provider's organization claims: company routes check our memberships (`requireMembership`).
 */
export interface Actor {
  readonly kind: ActorKind;
  readonly via: ActorVia;
  /**
   * The local user. A Clerk session of a person this server has not linked yet has none until `GET /api/me`
   * links them (reconcile on sign-in); company routes answer 404 to it meanwhile.
   */
  readonly userId?: string;
  /** The principal the credential belongs to (an API key's owner). */
  readonly principalId?: string;
  /** Set when the credential is bound to one company (an API key): the actor acts there only. */
  readonly companyId?: string;
  /** The provider's session (Clerk `sid`). */
  readonly sessionId?: string;
  /** For a Clerk session: who the verified token says it is (issuer, subject, pending task, org hint). */
  readonly identity?: VerifiedIdentity;
  /** For an API key: its row. */
  readonly apiKeyId?: string;
}

/** A refusal, answered as `{ error: { code, message, requestId } }` with this status. */
export interface AuthFailure {
  readonly ok: false;
  readonly status: 401 | 403 | 503;
  readonly code: string;
  readonly message: string;
}

export type AuthResult = { readonly ok: true; readonly actor: Actor } | AuthFailure;

/** The caller's membership in the company of the route, as `requireMembership` found it (active). */
export interface MemberContext {
  readonly id: string;
  readonly companyId: string;
  readonly principalId: string;
  readonly userId: string;
  readonly role: MembershipRole;
}

/** The environment of a route behind `authn()`. */
export interface AuthEnv extends AppEnv {
  Variables: AppEnv['Variables'] & { actor: Actor };
}

/** The environment of a route behind `authn()` and `requireMembership(role)`. */
export interface MemberEnv extends AuthEnv {
  Variables: AuthEnv['Variables'] & { tenant: TenantDb; membership: MemberContext };
}

/** A 401: no credential, or one that is not valid (unknown, malformed, expired, revoked). */
export function unauthenticated(message: string): AuthFailure {
  return { ok: false, status: 401, code: 'unauthenticated', message };
}
