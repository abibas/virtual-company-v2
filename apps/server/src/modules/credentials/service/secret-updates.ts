import { type Credential, diffFields, owned } from '@mwc/db';
import type { CredentialStatus } from '@mwc/shared/enums';
import type { CredentialsRepo } from '../repo.ts';
import {
  credentialAad,
  credentialView,
  purposeFits,
  USE_NOT_FOUND,
  USE_REVOKED,
  type UseRefusal,
} from '../rules.ts';
import { type KindSecret, parseSecret } from '../schemas/secrets.ts';
import type { AccountMeta, SubscriptionView } from '../schemas.ts';
import type { SecretDeps } from './secrets.ts';

/**
 * The store's changes to an existing credential, exposed by `credentialSecrets(deps)`: a new sealed secret in place of
 * the old one and its status (S3.3), and a login renewed by Sign in again. All act as the owner through the personal
 * layer and write audit rows with no secret in them.
 */

/** A secret of any kind; it is checked against the credential's own kind. */
export type AnySecret = KindSecret['secret'];

/**
 * Seals `secret` into the owner's credential in place of the one it had (S3.3: a login's refreshed token set), under
 * the current master key and the same id, owner and kind, with an audit row that says the secret was replaced and why,
 * never what it was (the system acting for the owner). A credential that is not this owner's (or is gone) and one
 * revoked at the provider are refused, with nothing changed; a secret of another shape throws a `ZodError`.
 */
export async function replaceCredentialSecret(
  deps: SecretDeps,
  repo: CredentialsRepo,
  credentialId: string,
  ownerUserId: string,
  secret: AnySecret,
  purpose: string,
  requestId: string | null = null,
): Promise<{ readonly ok: true; readonly credential: SubscriptionView } | UseRefusal> {
  if (!purposeFits(purpose)) throw new RangeError('A replacement names its purpose in 1 to 80 characters');
  return owned(deps.db, ownerUserId).transaction(async (tx) => {
    const row = await repo.get(tx, credentialId);
    if (row === undefined) return USE_NOT_FOUND;
    if (row.status === 'revoked') return USE_REVOKED;
    const sealed = deps.keyring.seal(parseSecret(row.kind, secret), credentialAad(row));
    const after = (await repo.update(tx, row.id, {
      keyVersion: sealed.keyVersion,
      iv: sealed.iv,
      authTag: sealed.tag,
      ciphertext: sealed.ciphertext,
      updatedAt: deps.clock(),
    })) as Credential;
    await repo.audit(tx, {
      actorKind: 'system',
      requestId,
      entityType: 'credential',
      entityId: row.id,
      action: 'replace_secret',
      changes: [
        {
          field: 'secret',
          old: { keyVersion: row.keyVersion },
          new: { keyVersion: after.keyVersion, purpose },
        },
      ],
    });
    return { ok: true, credential: credentialView(after) };
  });
}

/**
 * Sets the owner's credential's status (`needs_sign_in` when its login no longer works, `active` when it works again)
 * with its audit row, the system acting. A revoked one keeps its status; an unknown one, another person's or one
 * already in that status changes nothing. Returns whether it changed.
 */
export async function setCredentialStatus(
  deps: SecretDeps,
  repo: CredentialsRepo,
  credentialId: string,
  ownerUserId: string,
  status: Exclude<CredentialStatus, 'revoked'>,
  requestId: string | null = null,
): Promise<boolean> {
  return owned(deps.db, ownerUserId).transaction(async (tx) => {
    const row = await repo.get(tx, credentialId);
    if (row === undefined || row.status === status || row.status === 'revoked') return false;
    await repo.update(tx, row.id, { status, updatedAt: deps.clock() });
    await repo.audit(tx, {
      actorKind: 'system',
      requestId,
      entityType: 'credential',
      entityId: row.id,
      action: 'update',
      changes: diffFields({ status: row.status }, { status }),
    });
    return true;
  });
}

/** A finished login for Sign in again: its secret and the account it signed in to. */
export type RenewedLogin = KindSecret & {
  readonly accountEmail: string | null;
  readonly accountMeta: AccountMeta;
};

const accountOf = (row: Credential) => ({
  status: row.status,
  accountEmail: row.accountEmail,
  accountMeta: row.accountMeta,
});

/**
 * Sign in again: seals the new login into the owner's credential in place of the old one, under the same id, owner and
 * kind, and sets it `active` with the new login's account email and details. Its name and the access profiles that
 * point at it stay. The owner acts: a `replace_secret` audit row (never the secret) and an `update` row for what else
 * changed. Returns the account email it had before. A credential that is not this owner's (or is gone) and one revoked
 * at the provider are refused, with nothing changed; a secret of another kind's shape throws a `ZodError`.
 */
export async function renewCredentialLogin(
  deps: SecretDeps,
  repo: CredentialsRepo,
  credentialId: string,
  ownerUserId: string,
  login: RenewedLogin,
  requestId: string | null = null,
): Promise<
  | { readonly ok: true; readonly credential: SubscriptionView; readonly previousEmail: string | null }
  | UseRefusal
> {
  return owned(deps.db, ownerUserId).transaction(async (tx) => {
    const row = await repo.get(tx, credentialId);
    if (row === undefined) return USE_NOT_FOUND;
    if (row.status === 'revoked') return USE_REVOKED;
    const sealed = deps.keyring.seal(parseSecret(row.kind, login.secret), credentialAad(row));
    const after = (await repo.update(tx, row.id, {
      keyVersion: sealed.keyVersion,
      iv: sealed.iv,
      authTag: sealed.tag,
      ciphertext: sealed.ciphertext,
      status: 'active',
      accountEmail: login.accountEmail,
      accountMeta: login.accountMeta,
      updatedAt: deps.clock(),
    })) as Credential;
    const entry = { actorKind: 'user', requestId, entityType: 'credential', entityId: row.id } as const;
    await repo.audit(tx, {
      ...entry,
      action: 'replace_secret',
      changes: [
        {
          field: 'secret',
          old: { keyVersion: row.keyVersion },
          new: { keyVersion: after.keyVersion, purpose: 'sign_in_again' },
        },
      ],
    });
    const changes = diffFields(accountOf(row), accountOf(after));
    if (changes.length > 0) await repo.audit(tx, { ...entry, action: 'update', changes });
    return { ok: true, credential: credentialView(after), previousEmail: row.accountEmail };
  });
}
