import type { Credential } from '@mwc/db';
import { CREDENTIAL_LABEL, CREDENTIAL_PURPOSE, isToolKind } from '@mwc/shared/credentials';
import type { CredentialKind, CredentialStatus } from '@mwc/shared/enums';
import { toolCheckMessage } from './rules/tools.ts';
import type { KindSecret } from './schemas/secrets.ts';
import type { AccountMeta, AddSubscription, SubscriptionView, UpdateSubscription } from './schemas.ts';

/**
 * The additional data a credential's secret is sealed with, `credential|<id>|<ownerUserId>|<kind>`: a sealed value
 * copied onto another row, another person's or of another kind, does not open there.
 */
export function credentialAad(credential: {
  readonly id: string;
  readonly ownerUserId: string;
  readonly kind: CredentialKind;
}): string {
  return `credential|${credential.id}|${credential.ownerUserId}|${credential.kind}`;
}

/** A credential as the store takes it: its kind and secret, its name, and its non-secret account details. */
export type CredentialInput = KindSecret & { readonly label: string; readonly accountMeta: AccountMeta };

/** A gateway's address and its own paths, as its account details keep them (no paths: every CLI takes its default). */
const gatewayMeta = (baseUrl: string, paths: UpdateSubscription['paths']): AccountMeta =>
  paths === undefined || Object.keys(paths).length === 0 ? { baseUrl } : { baseUrl, paths };

/** A pasted subscription split into what is sealed (the secret) and what is shown (a gateway's address and paths). */
export function pastedCredential(body: AddSubscription): CredentialInput {
  switch (body.kind) {
    case 'claude_setup_token':
      return { kind: body.kind, secret: { token: body.token }, label: body.label, accountMeta: {} };
    case 'anthropic_api_key':
    case 'openai_api_key':
      return { kind: body.kind, secret: { apiKey: body.apiKey }, label: body.label, accountMeta: {} };
    case 'gateway':
      return {
        kind: body.kind,
        secret: { headers: body.headers },
        label: body.label,
        accountMeta: gatewayMeta(body.baseUrl, body.paths),
      };
  }
}

/** A trimmed name of 1 to 80 characters (`credentials_label_check`). */
export const labelFits = (label: string) =>
  label === label.trim() && label.length >= CREDENTIAL_LABEL.min && label.length <= CREDENTIAL_LABEL.max;

/** What a use names, 1 to 80 characters (`credential_uses_purpose_check`). */
export const purposeFits = (purpose: string) =>
  purpose.length >= CREDENTIAL_PURPOSE.min && purpose.length <= CREDENTIAL_PURPOSE.max;

/** The fields a credential's audit rows record: never its secret, IV, tag or ciphertext. */
export function audited(row: {
  readonly ownerUserId: string;
  readonly kind: CredentialKind;
  readonly label: string;
  readonly accountEmail: string | null;
  readonly accountMeta: AccountMeta;
  readonly status: CredentialStatus;
}) {
  return {
    ownerUserId: row.ownerUserId,
    kind: row.kind,
    label: row.label,
    accountEmail: row.accountEmail,
    accountMeta: row.accountMeta,
    status: row.status,
  };
}

/**
 * A gateway's account details after a change of its address or paths (given paths replace its own, `{}` clears them);
 * anything else they hold (an old `provider`, ignored since 2026-11-10) goes.
 */
export function updatedGatewayMeta(before: AccountMeta, change: UpdateSubscription): AccountMeta {
  const baseUrl = change.baseUrl ?? (typeof before.baseUrl === 'string' ? before.baseUrl : '');
  const kept = before.paths as UpdateSubscription['paths'];
  return gatewayMeta(baseUrl, change.paths ?? kept);
}

/** True when a change names a gateway's address, paths or headers. */
export const changesGateway = (change: UpdateSubscription): boolean =>
  change.baseUrl !== undefined || change.paths !== undefined || change.headers !== undefined;

/**
 * A credential as the API shows it: metadata only (a gateway's address, paths and header previews, a tool sign-in's
 * account and last check), never its secret or sealed columns.
 */
export function credentialView(row: Credential): SubscriptionView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    accountEmail: row.accountEmail,
    accountMeta: row.accountMeta,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    checkError:
      row.checkError !== null && isToolKind(row.kind)
        ? { code: row.checkError, message: toolCheckMessage(row.kind, row.checkError) }
        : null,
    headers: row.kind === 'gateway' ? row.headerPreviews : null,
  };
}

/** A refusal the routes answer in the common error shape. */
export interface Refusal<S extends 404 | 422 = 404> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

/** Another person's subscription, a removed one, or no such id: the same 404, so nobody learns which exist. */
export const CREDENTIAL_NOT_FOUND: Refusal = {
  ok: false,
  status: 404,
  code: 'credential_not_found',
  message: 'No such subscription',
};

/** An address, paths or headers for a subscription that is not a gateway. */
export const NOT_A_GATEWAY: Refusal<422> = {
  ok: false,
  status: 422,
  code: 'not_a_gateway',
  message: 'Only a gateway has an address, paths and headers',
};

/** Why a server-side use did not open a secret: none of this owner's, or one revoked at the provider. */
export interface UseRefusal {
  readonly ok: false;
  readonly code: 'credential_not_found' | 'credential_revoked';
  readonly message: string;
}

export const USE_NOT_FOUND: UseRefusal = {
  ok: false,
  code: 'credential_not_found',
  message: 'No such subscription of this owner',
};

export const USE_REVOKED: UseRefusal = {
  ok: false,
  code: 'credential_revoked',
  message: 'This subscription was revoked; add it again',
};
