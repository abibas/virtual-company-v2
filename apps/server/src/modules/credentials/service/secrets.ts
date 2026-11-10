import { type Credential, type DbHandle, diffFields, owned } from '@mwc/db';
import type { CredentialStatus } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import type { Keyring, Sealed } from '../../../platform/secrets/keyring.ts';
import { type CredentialsRepo, credentialsRepo, type UseContext } from '../repo.ts';
import {
  audited,
  credentialAad,
  credentialView,
  labelFits,
  purposeFits,
  USE_NOT_FOUND,
  USE_REVOKED,
  type UseRefusal,
} from '../rules.ts';
import { type KindSecret, parseSecret } from '../schemas/secrets.ts';
import type { AccountMeta, SubscriptionView } from '../schemas.ts';
import {
  type AnySecret,
  type RenewedLogin,
  renewCredentialLogin,
  replaceCredentialSecret,
  setCredentialStatus,
} from './secret-updates.ts';

/**
 * The credential store's internal service (S3.1), for the steps after it and never over HTTP: `storeCredential`
 * seals and saves a new credential (S3.2 saves sign-in results with it; the pasted kinds come through it too),
 * `useCredentialSecret` opens one on the server for a purpose (S3.3's usage checks, S5's runs), recording each use,
 * `replaceCredentialSecret` seals a new secret into an existing one (S3.3: a login's refreshed token set),
 * `setCredentialStatus` marks one as needing a sign-in (or usable again), and `renewCredentialLogin` puts a new login
 * into one in place (Sign in again). All act as the credential's owner through the personal layer, so another
 * person's credential is never reached.
 */

/** What the store needs: the database, the master keyring and the clock. */
export interface SecretDeps {
  readonly db: DbHandle;
  readonly keyring: Keyring;
  readonly clock: () => Date;
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
  /** Non-secret details only: plan, organization, scopes, a gateway's base URL and provider. */
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
 * Opens the owner's credential for `purpose` (`usage_check`, `chat_turn`, `chat_terminal`): checks it against its kind's
 * shape, records the use in `credential_uses` (with the company, agent, chat and who for a chat's) and moves
 * `last_used_at`. A credential that is not this owner's (or is gone) and one
 * revoked at the provider are refused, with nothing recorded; one that needs signing in again still opens (its
 * refresh may need it). A sealed value that does not open throws `SecretOpenError`, recording nothing.
 */
async function useCredentialSecret(
  deps: SecretDeps,
  repo: CredentialsRepo,
  credentialId: string,
  ownerUserId: string,
  purpose: string,
  context?: UseContext,
): Promise<UsedCredential> {
  if (!purposeFits(purpose)) throw new RangeError('A use names its purpose in 1 to 80 characters');
  const o = owned(deps.db, ownerUserId);
  const row = await repo.get(o, credentialId);
  if (row === undefined) return USE_NOT_FOUND;
  if (row.status === 'revoked') return USE_REVOKED;
  const secret = parseSecret(row.kind, deps.keyring.open(sealedOf(row), credentialAad(row)));
  const at = deps.clock();
  await repo.recordUse(o, row, purpose, at, context);
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
      context?: UseContext,
    ): Promise<UsedCredential> =>
      useCredentialSecret(deps, repo, credentialId, ownerUserId, purpose, context),
    replaceCredentialSecret: (
      credentialId: string,
      ownerUserId: string,
      secret: AnySecret,
      purpose: string,
      requestId?: string | null,
    ) => replaceCredentialSecret(deps, repo, credentialId, ownerUserId, secret, purpose, requestId),
    setCredentialStatus: (
      credentialId: string,
      ownerUserId: string,
      status: Exclude<CredentialStatus, 'revoked'>,
      requestId?: string | null,
    ): Promise<boolean> => setCredentialStatus(deps, repo, credentialId, ownerUserId, status, requestId),
    renewCredentialLogin: (
      credentialId: string,
      ownerUserId: string,
      login: RenewedLogin,
      requestId?: string | null,
    ) => renewCredentialLogin(deps, repo, credentialId, ownerUserId, login, requestId),
  };
}

export type CredentialSecrets = ReturnType<typeof credentialSecrets>;
