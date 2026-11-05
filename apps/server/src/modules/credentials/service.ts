import { diffFields, owned } from '@mwc/db';
import { credentialsRepo } from './repo.ts';
import { audited, CREDENTIAL_NOT_FOUND, credentialView, pastedCredential, type Refusal } from './rules.ts';
import type { AddSubscription, SubscriptionView } from './schemas.ts';
import { credentialSecrets, type SecretDeps } from './service/secrets.ts';

/** Who acts: the signed-in person (`c.var.userId`) and the request. */
export interface Caller {
  readonly userId: string;
  readonly requestId: string;
}

type Renamed = { readonly ok: true; readonly subscription: SubscriptionView } | Refusal;
type Removed = { readonly ok: true } | Refusal;

/**
 * The subscriptions API's logic, always as the caller (the personal layer): list their credentials, add a pasted one
 * (sealed by `storeCredential`), rename one, remove one. Another person's credential is the same 404 as none. Every
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

    /** Gives one of the caller's credentials a new name; the same name changes and records nothing. */
    rename(caller: Caller, credentialId: string, label: string): Promise<Renamed> {
      return owned(deps.db, caller.userId).transaction(async (tx) => {
        const row = await repo.get(tx, credentialId);
        if (row === undefined) return CREDENTIAL_NOT_FOUND;
        if (row.label === label) return { ok: true, subscription: credentialView(row) };
        const after = (await repo.update(tx, row.id, { label })) as typeof row;
        await repo.audit(tx, {
          actorKind: 'user',
          requestId: caller.requestId,
          entityType: 'credential',
          entityId: row.id,
          action: 'update',
          changes: diffFields({ label: row.label }, { label: after.label }),
        });
        return { ok: true, subscription: credentialView(after) };
      });
    },

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
