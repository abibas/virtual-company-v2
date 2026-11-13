import { type Credential, diffFields, type FieldChange, type OwnedDb, owned } from '@mwc/db';
import { type CredentialsRepo, credentialsRepo } from './repo.ts';
import { editHeaders, type HeaderEdit, previewsOf } from './rules/gateway-headers.ts';
import {
  audited,
  CREDENTIAL_NOT_FOUND,
  changesGateway,
  credentialAad,
  credentialView,
  NOT_A_GATEWAY,
  pastedCredential,
  type Refusal,
  updatedGatewayMeta,
} from './rules.ts';
import { parseSecret } from './schemas/secrets.ts';
import type { AddSubscription, SubscriptionView, UpdateSubscription } from './schemas.ts';
import { credentialSecrets, type SecretDeps, sealedOf } from './service/secrets.ts';

/** Who acts: the signed-in person (`c.var.userId`) and the request. */
export interface Caller {
  readonly userId: string;
  readonly requestId: string;
}

type Updated = { readonly ok: true; readonly subscription: SubscriptionView } | Refusal | Refusal<422>;
type Removed = { readonly ok: true } | Refusal;

/** A header edit's outcome: its audit changes and, when they are any, the newly sealed columns; or its refusal. */
type HeaderStep =
  | { readonly ok: true; readonly changes: FieldChange[]; readonly sealed?: Partial<Credential> }
  | Refusal<422>;

/**
 * Opens a gateway's stored headers for a step that needs their values (`purpose`: `preview`, `edit_headers`), recording
 * the use in `credential_uses` in the caller's transaction. `last_used_at` stays: it tells when a turn or a check last
 * used the gateway, and these steps never send its headers anywhere.
 */
async function openHeaders(
  deps: SecretDeps,
  repo: CredentialsRepo,
  tx: OwnedDb,
  row: Credential,
  purpose: string,
) {
  const { headers } = parseSecret('gateway', deps.keyring.open(sealedOf(row), credentialAad(row)));
  await repo.insertUse(tx, row.id, purpose, deps.clock());
  return headers;
}

/** A gateway's headers after `edits` (`editHeaders`), sealed again with their previews when anything changed. */
async function headerStep(
  deps: SecretDeps,
  repo: CredentialsRepo,
  tx: OwnedDb,
  row: Credential,
  edits: readonly HeaderEdit[],
): Promise<HeaderStep> {
  const edited = editHeaders(await openHeaders(deps, repo, tx, row, 'edit_headers'), edits);
  if (!edited.ok || edited.changes.length === 0) return edited;
  const sealed = deps.keyring.seal({ headers: edited.headers }, credentialAad(row));
  return {
    ok: true,
    changes: edited.changes,
    sealed: {
      keyVersion: sealed.keyVersion,
      iv: sealed.iv,
      authTag: sealed.tag,
      ciphertext: sealed.ciphertext,
      headerPreviews: previewsOf(edited.headers),
    },
  };
}

/**
 * Gives one of the caller's credentials a new name, and a gateway a new address, paths or headers (sealed again, audited
 * by header names only, with a `replace_secret` row); what is already so changes and records nothing. An address, paths
 * or headers for another kind is 422, and so is a header edit that cannot be made.
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
    const headers = change.headers && (await headerStep(deps, repo, tx, row, change.headers));
    if (headers?.ok === false) return headers;
    const before = { label: row.label, accountMeta: row.accountMeta };
    const after = {
      label: change.label ?? row.label,
      accountMeta: changesGateway(change) ? updatedGatewayMeta(row.accountMeta, change) : row.accountMeta,
    };
    const changes = [...diffFields(before, after), ...(headers?.changes ?? [])];
    if (changes.length === 0) return { ok: true, subscription: credentialView(row) };
    const sealed = headers?.sealed;
    const updated = (await repo.update(tx, row.id, {
      ...after,
      ...sealed,
      updatedAt: deps.clock(),
    })) as Credential;
    const entry = {
      actorKind: 'user',
      requestId: caller.requestId,
      entityType: 'credential',
      entityId: row.id,
    } as const;
    await repo.audit(tx, { ...entry, action: 'update', changes });
    if (sealed !== undefined) {
      const secret = {
        old: { keyVersion: row.keyVersion },
        new: { keyVersion: updated.keyVersion, purpose: 'edit_headers' },
      };
      await repo.audit(tx, { ...entry, action: 'replace_secret', changes: [{ field: 'secret', ...secret }] });
    }
    return { ok: true, subscription: credentialView(updated) };
  });
}

/**
 * Makes the previews of the caller's gateways sealed before previews were stored (migration
 * `0034_gateway_header_previews` adds the column empty, since SQL cannot open a sealed value), once each: the first list
 * opens each such gateway, records a `preview` use and stores its previews. One that does not open stays without them.
 */
async function withPreviews(deps: SecretDeps, repo: CredentialsRepo, userId: string, rows: Credential[]) {
  const made = new Map<string, Credential>();
  for (const row of rows) {
    if (row.kind !== 'gateway' || row.headerPreviews !== null) continue;
    try {
      await owned(deps.db, userId).transaction(async (tx) => {
        const headerPreviews = previewsOf(await openHeaders(deps, repo, tx, row, 'preview'));
        const after = await repo.update(tx, row.id, { headerPreviews, updatedAt: row.updatedAt });
        if (after !== undefined) made.set(row.id, after);
      });
    } catch {
      // A value that does not open (another master key, a damaged row) leaves the gateway without previews.
    }
  }
  return rows.map((row) => made.get(row.id) ?? row);
}

/**
 * The subscriptions API's logic, always as the caller (the personal layer): list their credentials, add a pasted one
 * (sealed by `storeCredential`), rename one (and change a gateway's address, paths or headers), remove one. Another
 * person's credential is the same 404 as none. Every change writes its audit rows, which carry no secret.
 */
export function credentialsService(deps: SecretDeps) {
  const repo = credentialsRepo();
  const secrets = credentialSecrets(deps);
  return {
    /** The caller's credentials, oldest first, as metadata (a gateway with its header previews, `withPreviews`). */
    async list(caller: Caller): Promise<SubscriptionView[]> {
      const rows = await repo.list(owned(deps.db, caller.userId));
      return (await withPreviews(deps, repo, caller.userId, rows)).map(credentialView);
    },

    /** Seals and saves a pasted subscription for the caller; no provider is called. */
    add(caller: Caller, body: AddSubscription): Promise<SubscriptionView> {
      const input = pastedCredential(body);
      return secrets.storeCredential({ ...input, ownerUserId: caller.userId, requestId: caller.requestId });
    },

    /** Renames one of the caller's credentials, or changes a gateway's address, paths or headers (`updateCredential`). */
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
