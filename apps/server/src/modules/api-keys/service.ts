import { type ApiKey, diffFields, type TenantDb } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { generateApiKey } from '../../platform/auth/api-keys.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { profilesOf } from '../identity/service.ts';
import { type ApiKeysRepo, apiKeysRepo } from './repo.ts';
import {
  expiryAt,
  KEY_NOT_FOUND,
  keyStatusAt,
  listAllRefusal,
  mintRefusal,
  NOT_ACTIVE,
  type Refusal,
  revokeRefusal,
} from './rules.ts';
import type { ApiKeyOwner, ApiKeyView, CreatedApiKeyView } from './schemas.ts';

const iso = (at: Date | null) => at?.toISOString() ?? null;

/** A key as the API shows it, with its status as of `now`: never its hash. */
export function apiKeyView(row: ApiKey, now: Date, owner?: ApiKeyOwner): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    prefix: row.prefix,
    scopes: row.scopes,
    status: keyStatusAt(row, now),
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
    ...(owner === undefined ? {} : { owner }),
  };
}

/** What a key's creation records in the audit log: never the secret or its hash. */
const audited = (row: ApiKey) => ({
  kind: row.kind,
  name: row.name,
  prefix: row.prefix,
  principalId: row.principalId,
  scopes: row.scopes,
  expiresAt: row.expiresAt,
});

/** Who acts, from the route's `c.var.membership` and `c.var.actor`. */
export interface Caller {
  readonly membershipId: string;
  readonly principalId: string;
  readonly role: MembershipRole;
  readonly requestId: string;
  readonly now: Date;
}

export interface NewKey extends Caller {
  /** How the caller signed in (`c.var.actor.via`): only a session makes keys. */
  readonly via: string;
  readonly name: string;
  readonly expiresInDays: number;
}

type Created = { readonly ok: true; readonly key: CreatedApiKeyView } | Refusal;
type Revoked = { readonly ok: true; readonly key: ApiKeyView } | Refusal;
type Listed = { readonly ok: true; readonly keys: ApiKeyView[] } | Refusal;

/**
 * Makes a personal key for the caller: a session only (403 for an API key), under the company's lock with the
 * caller's membership read again (a removal running at the same time either sees this key and revokes it, or this
 * sees the removal and refuses). Stores the SHA-256 and the display prefix with an audit row, and returns the whole
 * key once.
 */
async function createKey(repo: ApiKeysRepo, t: TenantDb, call: NewKey): Promise<Created> {
  const refusal = mintRefusal(call.via);
  if (refusal) return refusal;
  return t.transaction(async (tx) => {
    const member = await repo.lockedMember(tx, call.membershipId);
    if (member?.status !== 'active') return NOT_ACTIVE;
    const generated = generateApiKey('personal');
    const row = await repo.insert(tx, {
      principalId: member.principalId,
      kind: 'personal',
      name: call.name,
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: [],
      expiresAt: expiryAt(call.now, call.expiresInDays),
    });
    await repo.audit(tx, {
      actorKind: 'user',
      actorPrincipalId: member.principalId,
      requestId: call.requestId,
      entityType: 'api_key',
      entityId: row.id,
      action: 'create',
      changes: diffFields(null, audited(row)),
    });
    return { ok: true as const, key: { ...apiKeyView(row, call.now), secret: generated.key } };
  });
}

/**
 * Revokes a key: anyone their own, admins and owners anyone's (403 otherwise); an unknown key, or another company's,
 * is a 404. A key revoked already is a no-op that writes nothing.
 */
async function revokeKey(repo: ApiKeysRepo, t: TenantDb, call: Caller & { keyId: string }): Promise<Revoked> {
  const key = await repo.get(t, call.keyId);
  if (key === undefined) return KEY_NOT_FOUND;
  const refusal = revokeRefusal(call.role, key.principalId === call.principalId);
  if (refusal) return refusal;
  const after = await t.transaction(async (tx) => {
    const revoked = await repo.revoke(tx, key.id, call.now);
    if (revoked === undefined) return (await repo.get(tx, key.id)) as ApiKey;
    await repo.audit(tx, {
      actorKind: 'user',
      actorPrincipalId: call.principalId,
      requestId: call.requestId,
      entityType: 'api_key',
      entityId: key.id,
      action: 'revoke',
      changes: diffFields({ revokedAt: key.revokedAt }, { revokedAt: revoked.revokedAt }),
    });
    return revoked;
  });
  return { ok: true, key: apiKeyView(after, call.now) };
}

/**
 * The API keys module's logic: make, list and revoke personal keys. Scopes are stored empty, which means full access
 * as the member who owns the key, in its company only; the owners' profiles come from the identity module's service.
 */
export function apiKeysService(deps: Pick<ServerDeps, 'db'>) {
  const repo = apiKeysRepo();
  /** The owner of each key, from the memberships of the keys' principals and the people's profiles. */
  const withOwners = async (t: TenantDb, rows: readonly ApiKey[], now: Date) => {
    const members = await repo.membersOf(t, [...new Set(rows.map((row) => row.principalId))]);
    const profiles = await profilesOf(
      deps.db,
      members.map((member) => member.userId),
    );
    const byPrincipal = new Map(members.map((member) => [member.principalId, member.userId]));
    return rows.map((row) => {
      const userId = byPrincipal.get(row.principalId) ?? null;
      const profile = userId === null ? undefined : profiles.get(userId);
      const owner = {
        principalId: row.principalId,
        userId,
        displayName: profile?.displayName ?? '',
        email: profile?.primaryEmail ?? '',
      };
      return apiKeyView(row, now, owner);
    });
  };
  return {
    create: (t: TenantDb, call: NewKey) => createKey(repo, t, call),

    /** The caller's own keys, or with `all` every personal key in the company with its owner (admin and above). */
    async list(t: TenantDb, call: Caller & { all: boolean }): Promise<Listed> {
      if (!call.all) {
        const rows = await repo.listOf(t, call.principalId);
        return { ok: true, keys: rows.map((row) => apiKeyView(row, call.now)) };
      }
      const refusal = listAllRefusal(call.role);
      if (refusal) return refusal;
      return { ok: true, keys: await withOwners(t, await repo.listAll(t), call.now) };
    },

    revoke: (t: TenantDb, call: Caller & { keyId: string }) => revokeKey(repo, t, call),
  };
}
