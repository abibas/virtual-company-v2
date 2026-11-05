import type { Credential } from '@mwc/db';
import { CREDENTIAL_LABEL, CREDENTIAL_PURPOSE } from '@mwc/shared/credentials';
import type { CredentialKind, CredentialStatus } from '@mwc/shared/enums';
import type { KindSecret } from './schemas/secrets.ts';
import type { AccountMeta, AddSubscription, SubscriptionView } from './schemas.ts';

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

/** A pasted subscription split into what is sealed (the secret) and what is shown (a gateway's address). */
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
        accountMeta: { baseUrl: body.baseUrl },
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

/** A credential as the API shows it: metadata only, never its secret or sealed columns. */
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
  };
}

/** A refusal the routes answer in the common error shape. */
export interface Refusal {
  readonly ok: false;
  readonly status: 404;
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
