import { type Credential, type DbHandle, diffFields, owned } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import type { Keyring, Sealed } from '../../../platform/secrets/keyring.ts';
import { type CredentialsRepo, credentialsRepo } from '../repo.ts';
import {
  audited,
  credentialAad,
  labelFits,
  purposeFits,
  USE_NOT_FOUND,
  USE_REVOKED,
  type UseRefusal,
} from '../rules.ts';
import { type KindSecret, parseSecret } from '../schemas/secrets.ts';
import type { AccountMeta, SubscriptionView } from '../schemas.ts';

/**
 * The credential store's internal service (S3.1), for the steps after it and never over HTTP: `storeCredential`
 * seals and saves a new credential (S3.2 saves sign-in results with it; the pasted kinds come through it too), and
 * `useCredentialSecret` opens one on the server for a purpose (S3.3's usage checks, S5's runs), recording each use.
 * Both act as the credential's owner through the personal layer, so another person's credential is never reached.
 */

/** What the store needs: the database, the master keyring and the clock. */
export interface SecretDeps {
  readonly db: DbHandle;
  readonly keyring: Keyring;
  readonly clock: () => Date;
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

const sealedOf = (row: Credential): Sealed => ({
  keyVersion: row.keyVersion,
  iv: row.iv,
  tag: row.authTag,
  ciphertext: row.ciphertext,
});

/** A new credential: whose, its kind and secret, its name, the account it belongs to, and the request that made it. */
export type StoreCredentialInput = KindSecret & {
  readonly ownerUserId: string;
  /** Trimmed here; 1 to 80 characters. */
  readonly label: string;
  readonly accountEmail?: string | null;
  /** Non-secret details only: plan, organization, scopes, a gateway's base URL. */
  readonly accountMeta?: AccountMeta;
  readonly requestId?: string | null;
};

/** An opened secret with the credential it belongs to, narrowed by `kind`; or why it was not opened. */
export type UsedCredential =
  | ({ readonly ok: true; readonly credential: SubscriptionView } & KindSecret)
  | UseRefusal;

/**
 * Checks the secret against its kind's shape, seals it under the current master key with the new id, owner and kind
 * as additional data, and saves it with its `create` audit rows (the owner acting; no secret in them) in one
 * transaction. Throws a `RangeError` for a name that does not fit and a `ZodError` for a secret of another shape.
 */
async function storeCredential(
  deps: SecretDeps,
  repo: CredentialsRepo,
  input: StoreCredentialInput,
): Promise<SubscriptionView> {
  const label = input.label.trim();
  if (!labelFits(label)) throw new RangeError('A subscription is named in 1 to 80 characters');
  const secret = parseSecret(input.kind, input.secret);
  const id = newId();
  const sealed = deps.keyring.seal(
    secret,
    credentialAad({ id, ownerUserId: input.ownerUserId, kind: input.kind }),
  );
  return owned(deps.db, input.ownerUserId).transaction(async (tx) => {
    const row = await repo.insert(tx, {
      id,
      kind: input.kind,
      label,
      accountEmail: input.accountEmail ?? null,
      accountMeta: input.accountMeta ?? {},
      keyVersion: sealed.keyVersion,
      iv: sealed.iv,
      authTag: sealed.tag,
      ciphertext: sealed.ciphertext,
    });
    await repo.audit(tx, {
      actorKind: 'user',
      requestId: input.requestId ?? null,
      entityType: 'credential',
      entityId: row.id,
      action: 'create',
      changes: diffFields(null, audited(row)),
    });
    return credentialView(row);
  });
}

/**
 * Opens the owner's credential for `purpose` (`usage_check`, later `run`): checks it against its kind's shape, records
 * the use in `credential_uses` and moves `last_used_at`. A credential that is not this owner's (or is gone) and one
 * revoked at the provider are refused, with nothing recorded; one that needs signing in again still opens (its
 * refresh may need it). A sealed value that does not open throws `SecretOpenError`, recording nothing.
 */
async function useCredentialSecret(
  deps: SecretDeps,
  repo: CredentialsRepo,
  credentialId: string,
  ownerUserId: string,
  purpose: string,
): Promise<UsedCredential> {
  if (!purposeFits(purpose)) throw new RangeError('A use names its purpose in 1 to 80 characters');
  const o = owned(deps.db, ownerUserId);
  const row = await repo.get(o, credentialId);
  if (row === undefined) return USE_NOT_FOUND;
  if (row.status === 'revoked') return USE_REVOKED;
  const secret = parseSecret(row.kind, deps.keyring.open(sealedOf(row), credentialAad(row)));
  const at = deps.clock();
  await repo.recordUse(o, row, purpose, at);
  const credential = credentialView({ ...row, lastUsedAt: at });
  return { ok: true, credential, kind: row.kind, secret } as UsedCredential;
}

/** The store's internal service on these deps. */
export function credentialSecrets(deps: SecretDeps) {
  const repo = credentialsRepo();
  return {
    storeCredential: (input: StoreCredentialInput): Promise<SubscriptionView> =>
      storeCredential(deps, repo, input),
    useCredentialSecret: (
      credentialId: string,
      ownerUserId: string,
      purpose: string,
    ): Promise<UsedCredential> => useCredentialSecret(deps, repo, credentialId, ownerUserId, purpose),
  };
}

export type CredentialSecrets = ReturnType<typeof credentialSecrets>;
