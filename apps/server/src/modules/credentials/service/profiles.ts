import {
  type AccessProfile,
  type DbHandle,
  diffFields,
  isUniqueViolation,
  type OwnedDb,
  owned,
} from '@mwc/db';
import { auditProfileRemoval } from '../../org/service.ts';
import { profileRows as repo } from '../repo/profiles.ts';
import { runsAfter, runsRefusal } from '../rules/profile-model.ts';
import {
  auditedProfile,
  type CredentialChoice,
  credentialRefusal,
  PROFILE_NOT_FOUND,
  type ProfileRefusal,
  partsPutIn,
  profileChanges,
  profileNameTaken,
  providerFixed,
} from '../rules/profiles.ts';
import type { AccessProfileView, CreateAccessProfile, UpdateAccessProfile } from '../schemas/profiles.ts';
import type { Caller } from '../service.ts';
import { agentsByProfile, companiesOfUser, views } from './profiles/views.ts';

type Saved<S extends 404 | 409 | 422> =
  | { readonly ok: true; readonly profile: AccessProfileView }
  | ProfileRefusal<S>;

const NAME_UNIQUE = 'access_profiles_owner_user_id_name_unique';

/** Why a change may not give a `provider` profile these credentials (`credentialRefusal`), read as the owner. */
async function choiceRefusal(
  o: OwnedDb,
  profile: Parameters<typeof partsPutIn>[0] & { readonly provider: AccessProfile['provider'] },
  choice: CredentialChoice,
) {
  const putIn = partsPutIn(profile, choice);
  if (putIn.length === 0) return undefined;
  const held = await repo.credentialsOf(
    o,
    putIn.map(([, id]) => id),
  );
  const found = new Map(held.map((row) => [row.id, row]));
  for (const [part, id] of putIn) {
    const refusal = credentialRefusal(part, profile.provider, found.get(id));
    if (refusal) return refusal;
  }
  return undefined;
}

/** Runs a profile's write, answering a name the owner has given another profile with 409. */
async function namedWrite<T>(
  name: string | undefined,
  write: () => Promise<T>,
): Promise<T | ProfileRefusal<409>> {
  try {
    return await write();
  } catch (error) {
    if (name !== undefined && isUniqueViolation(error, NAME_UNIQUE)) return profileNameTaken(name);
    throw error;
  }
}

/** A profile's audit entry, by its owner. */
const entry = (caller: Caller, id: string, action: string, changes: ReturnType<typeof diffFields>) =>
  ({
    actorKind: 'user',
    requestId: caller.requestId,
    entityType: 'access_profile',
    entityId: id,
    action,
    changes,
  }) as const;

/** The caller's profile after a write, shown with the agents using it (read after the write's transaction). */
async function shown(db: DbHandle, caller: Caller, row: AccessProfile): Promise<Saved<never>> {
  const uses = await agentsByProfile(db, caller.userId, [row.id]);
  const [profile] = (await views(owned(db, caller.userId), [row], uses)) as [AccessProfileView];
  return { ok: true, profile };
}

type Deps = { readonly db: DbHandle };

/** The caller's profiles, oldest first, with their credentials and the agents using each. */
async function listProfiles(deps: Deps, caller: Caller): Promise<AccessProfileView[]> {
  const o = owned(deps.db, caller.userId);
  const rows = await repo.listProfiles(o);
  const ids = rows.map((row) => row.id);
  const uses = await agentsByProfile(deps.db, caller.userId, ids);
  return views(o, rows, uses);
}

/**
 * A new profile of the caller's, its model and effort and its credentials checked against its provider (422), its name
 * unique (409).
 */
async function createProfile(
  deps: Deps,
  caller: Caller,
  body: CreateAccessProfile,
): Promise<Saved<409 | 422>> {
  const runs = { model: body.model ?? null, effort: body.effort ?? null };
  const refused = runsRefusal(body.provider, runs);
  if (refused) return refused;
  const saved = await namedWrite(body.name, () =>
    owned(deps.db, caller.userId).transaction(async (o) => {
      const refusal = await choiceRefusal(o, { provider: body.provider }, body);
      if (refusal) return refusal;
      const { name, provider, credentialId, gatewayCredentialId } = body;
      const values = { name, provider, credentialId, gatewayCredentialId, ...runs };
      const row = await repo.insertProfile(o, values);
      await o.audit(entry(caller, row.id, 'create', diffFields(null, auditedProfile(row))));
      return row;
    }),
  );
  return 'ok' in saved ? saved : shown(deps.db, caller, saved);
}

/**
 * Renames one of the caller's profiles or changes its credentials, model or effort (its provider is fixed: 422
 * `provider_mismatch`; a model and effort it may run, `runsRefusal`); only what differs is written and audited.
 */
async function updateProfile(
  deps: Deps,
  caller: Caller,
  change: { readonly profileId: string; readonly patch: UpdateAccessProfile },
): Promise<Saved<404 | 409 | 422>> {
  const { profileId, patch } = change;
  const saved = await namedWrite(patch.name, () =>
    owned(deps.db, caller.userId).transaction(async (o) => {
      const row = await repo.getProfile(o, profileId);
      if (row === undefined) return PROFILE_NOT_FOUND;
      if (patch.provider !== undefined && patch.provider !== row.provider) return providerFixed(row.provider);
      const refusal = await choiceRefusal(o, row, patch);
      if (refusal) return refusal;
      const set = profileChanges(row, patch);
      if (Object.keys(set).length === 0) return row;
      const refused =
        'model' in set || 'effort' in set ? runsRefusal(row.provider, runsAfter(row, set)) : undefined;
      if (refused) return refused;
      const after = await repo.updateProfile(o, row.id, set);
      await o.audit(entry(caller, row.id, 'update', diffFields(auditedProfile(row), auditedProfile(after))));
      return after;
    }),
  );
  return 'ok' in saved ? saved : shown(deps.db, caller, saved);
}

/**
 * Removes one of the caller's profiles: in one transaction, the audit rows of the agents and defaults it leaves in
 * each of the caller's companies (`auditProfileRemoval`, under each company's lock), then the row, whose foreign keys
 * take it off them, and its own audit rows.
 */
async function removeProfile(
  deps: Deps,
  caller: Caller,
  profileId: string,
): Promise<{ readonly ok: true } | ProfileRefusal<404>> {
  const companies = await companiesOfUser(deps.db, caller.userId);
  return owned(deps.db, caller.userId).transaction(async (o) => {
    const row = await repo.getProfile(o, profileId);
    if (row === undefined) return PROFILE_NOT_FOUND;
    const by = { userId: caller.userId, requestId: caller.requestId };
    for (const company of companies) await auditProfileRemoval(await o.tenant(company.companyId), row.id, by);
    await repo.removeProfile(o, row.id);
    await o.audit(entry(caller, row.id, 'delete', diffFields(auditedProfile(row), null)));
    return { ok: true as const };
  });
}

/**
 * The access profiles API's logic (S3.4, one provider each since 2026-11-10), always as the caller (the personal layer):
 * list their profiles, create one, change one, remove one. A profile's provider is fixed when it is made; its
 * subscription is one of the caller's own of that provider, its gateway any of their gateways, never a
 * revoked one, its model one of that provider's and its effort one its model takes (422); a name is unique among theirs (409); another person's profile is the same 404 as none. Every change writes
 * its `access_profile` audit rows; removing one also writes, in each of the caller's companies, the rows of the agents
 * and defaults it leaves (the org module's `auditProfileRemoval`), before the foreign keys detach it.
 */
export function accessProfilesService(deps: Deps) {
  return {
    list: (caller: Caller) => listProfiles(deps, caller),
    create: (caller: Caller, body: CreateAccessProfile) => createProfile(deps, caller, body),
    update: (caller: Caller, profileId: string, patch: UpdateAccessProfile) =>
      updateProfile(deps, caller, { profileId, patch }),
    remove: (caller: Caller, profileId: string) => removeProfile(deps, caller, profileId),
  };
}
