import { PERSONAL_KEY_DAYS } from '@mwc/shared/api-keys';
import type { MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';

/** A refusal the routes answer in the common error shape. */
export interface Refusal {
  readonly ok: false;
  readonly status: 403 | 404;
  readonly code: string;
  readonly message: string;
}

const refuse = (status: Refusal['status'], code: string, message: string): Refusal => ({
  ok: false,
  status,
  code,
  message,
});

export const KEY_NOT_FOUND = refuse(404, 'api_key_not_found', 'No such API key in this company');
export const NOT_ACTIVE = refuse(403, 'forbidden', 'You are no longer an active member of this company');

const DAY_MS = 86_400_000;

/** When a personal key made at `now` expires: `days` later (the schema keeps them within 1 to 365). */
export function expiryAt(now: Date, days: number = PERSONAL_KEY_DAYS.default): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

/** A key's state as of `now`: revoked wins over expired; expiring at `now` counts as expired (as `authn()` does). */
export function keyStatusAt(
  key: { readonly revokedAt: Date | null; readonly expiresAt: Date | null },
  now: Date,
): ApiKeyStatus {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt !== null && key.expiresAt <= now) return 'expired';
  return 'active';
}

/**
 * Why this caller may not make a key, or undefined when it may: only a person signed in with a session. A key never
 * mints keys, so a leaked key cannot outlive its own expiry or revocation.
 */
export function mintRefusal(via: string): Refusal | undefined {
  if (via === 'clerk') return undefined;
  return refuse(403, 'forbidden', 'API keys are made signed in to the web app, not with an API key');
}

/** `?all=1` turns the list into every personal key in the company. */
export const wantsAll = (all: string | undefined) => all === '1' || all === 'true';

/** Why a member may not list every key in the company, or undefined: admins and owners may. */
export function listAllRefusal(role: MembershipRole): Refusal | undefined {
  if (roleAtLeast(role, 'admin')) return undefined;
  return refuse(403, 'forbidden', "Only an owner or an admin may list everyone's API keys");
}

/** Why a member may not revoke a key, or undefined: anyone revokes their own, admins and owners anyone's. */
export function revokeRefusal(role: MembershipRole, own: boolean): Refusal | undefined {
  if (own || roleAtLeast(role, 'admin')) return undefined;
  return refuse(403, 'forbidden', "Only an owner or an admin may revoke someone else's API key");
}
