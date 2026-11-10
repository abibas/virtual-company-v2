import { diffFields, owned } from '@mwc/db';
import { credentialsRepo } from './repo.ts';
import {
  audited,
  CREDENTIAL_NOT_FOUND,
  changesGateway,
  credentialView,
  NOT_A_GATEWAY,
  pastedCredential,
  type Refusal,
  updatedGatewayMeta,
} from './rules.ts';
import type { AddSubscription, SubscriptionView, UpdateSubscription } from './schemas.ts';
import { credentialSecrets, type SecretDeps } from './service/secrets.ts';

/** Who acts: the signed-in person (`c.var.userId`) and the request. */
export interface Caller {
  readonly userId: string;
  readonly requestId: string;
}

type Updated = { readonly ok: true; readonly subscription: SubscriptionView } | Refusal | Refusal<422>;
type Removed = { readonly ok: true } | Refusal;

/**
 * Gives one of the caller's credentials a new name, and a gateway a new address or paths (its headers stay sealed as they
 * are); what is already so changes and records nothing. An address or paths for another kind is 422.
 */
function updateCredential(
  deps: SecretDeps,
  caller: Caller,
  credentialId: string,
  change: UpdateSubscription,
): Promise<Updated> {
  const repo = credentialsRepo();
  return owned(deps.db, caller.userId).transaction(async (tx) => {
    const row = await repo.get(tx, credentialId);
    if (row === undefined) return CREDENTIAL_NOT_FOUND;
    if (changesGateway(change) && row.kind !== 'gateway') return NOT_A_GATEWAY;
    const before = { label: row.label, accountMeta: row.accountMeta };
    const after = {
      label: change.label ?? row.label,
      accountMeta: changesGateway(change) ? updatedGatewayMeta(row.accountMeta, change) : row.accountMeta,
    };
    const changes = diffFields(before, after);
    if (changes.length === 0) return { ok: true, subscription: credentialView(row) };
    const updated = (await repo.update(tx, row.id, { ...after, updatedAt: deps.clock() })) as typeof row;
    await repo.audit(tx, {
      actorKind: 'user',
      requestId: caller.requestId,
      entityType: 'credential',
      entityId: row.id,
      action: 'update',
      changes,
    });
    return { ok: true, subscription: credentialView(updated) };
  });
}

/**
 * The subscriptions API's logic, always as the caller (the personal layer): list their credentials, add a pasted one
 * (sealed by `storeCredential`), rename one (and change a gateway's address or paths), remove one. Another person's credential is the same 404 as none. Every
 * change writes its audit rows, which carry no secret.
 */
export function credentialsService(deps: SecretDeps) {
  const repo = credentialsRepo();
  const secrets = credentialSecrets(deps);
  return {
    /** The caller's credentials, oldest first, as metadata. */
    async list(caller: Caller): Promise<SubscriptionView[]> {
      return (await repo.list(owned(deps.db, caller.userId))).map(credentialView);
    },

    /** Seals and saves a pasted subscription for the caller; no provider is called. */
    add(caller: Caller, body: AddSubscription): Promise<SubscriptionView> {
      const input = pastedCredential(body);
      return secrets.storeCredential({ ...input, ownerUserId: caller.userId, requestId: caller.requestId });
    },

    /** Renames one of the caller's credentials, or changes a gateway's address or paths (`updateCredential`). */
    update: (caller: Caller, credentialId: string, change: UpdateSubscription) =>
      updateCredential(deps, caller, credentialId, change),

    /** Removes one of the caller's credentials and its secret; its audit rows and uses stay on record. */
    remove(caller: Caller, credentialId: string): Promise<Removed> {
      return owned(deps.db, caller.userId).transaction(async (tx) => {
        const row = await repo.remove(tx, credentialId);
        if (row === undefined) return CREDENTIAL_NOT_FOUND;
        await repo.audit(tx, {
          actorKind: 'user',
          requestId: caller.requestId,
          entityType: 'credential',
          entityId: row.id,
          action: 'delete',
          changes: diffFields(audited(row), null),
        });
        return { ok: true };
      });
    },
  };
}
