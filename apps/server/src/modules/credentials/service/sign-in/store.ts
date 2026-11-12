import { isToolKind } from '@mwc/shared/credentials';
import type { LoginResult } from '../../rules/login-files.ts';
import { accountChanged, SIGN_IN_ENDINGS } from '../../rules/sign-in.ts';
import type { SessionContext, SessionOwner } from './context.ts';

/** What a sign-in stores: a new subscription (with the name given), or a login renewing the caller's own one. */
export type SignInTarget = { readonly label?: string | undefined } | { readonly renew: string };

/** What storing a finished login came to: the stored sign-in, or why nothing was stored (and the log's reason). */
export type Stored =
  | {
      readonly ok: true;
      readonly credentialId: string;
      readonly accountChanged: boolean;
      readonly reason: string;
    }
  | { readonly ok: false; readonly message: string; readonly reason: string };

/**
 * Stores a finished login under its owner (`storeCredential`), or renews their own sign-in in place
 * (`renewCredentialLogin`; gone or revoked meanwhile, nothing is stored). A tool sign-in (GitHub's) keeps its first
 * check: its CLI has just asked GitHub who signed in, so the server opened no secret and records no use.
 */
export async function storeLogin(
  ctx: SessionContext,
  owner: SessionOwner,
  target: SignInTarget,
  result: LoginResult,
): Promise<Stored> {
  const checked = isToolKind(result.kind) ? { checked: { at: ctx.clock(), used: false } } : {};
  const { userId, requestId } = owner;
  if ('renew' in target) {
    const renewed = await ctx.secrets.renewCredentialLogin(
      target.renew,
      userId,
      { ...result, ...checked },
      requestId,
    );
    if (!renewed.ok) return { ok: false, message: SIGN_IN_ENDINGS.gone, reason: renewed.code };
    const changed = accountChanged(renewed.previousEmail, renewed.credential.accountEmail);
    return { ok: true, credentialId: renewed.credential.id, accountChanged: changed, reason: 'renewed' };
  }
  const { label, ...login } = result;
  const stored = await ctx.secrets.storeCredential({
    ...login,
    ...checked,
    label: target.label ?? label,
    ownerUserId: userId,
    requestId,
  });
  return { ok: true, credentialId: stored.id, accountChanged: false, reason: 'stored' };
}
