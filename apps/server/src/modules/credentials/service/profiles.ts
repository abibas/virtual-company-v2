import {
  type AccessProfile,
  type DbHandle,
  diffFields,
  isUniqueViolation,
  type OwnedDb,
  owned,
} from '@mwc/db';
import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import { auditProfileRemoval } from '../../org/service.ts';
import { profileRows as repo } from '../repo/profiles.ts';
import { partColumns, partInUse, removedAiParts, runsAfterChange, secondAiPart } from '../rules/parts.ts';
import { runsRefusal } from '../rules/profile-model.ts';
import {
  auditedProfile,
  credentialRefusal,
  PROFILE_NOT_FOUND,
  type ProfileChange,
  type ProfileFields,
  type ProfileRefusal,
  partsPutIn,
  profileChanges,
  profileNameTaken,
} from '../rules/profiles.ts';
import type { AccessProfileView, CreateAccessProfile, UpdateAccessProfile } from '../schemas/profiles.ts';
import type { Caller } from '../service.ts';
import { agentsByProfile, companiesOfUser, type ProfileUser, views } from './profiles/views.ts';

type Saved<S extends 404 | 409 | 422> =
  | { readonly ok: true; readonly profile: AccessProfileView }
  | ProfileRefusal<S>;

const NAME_UNIQUE = 'access_profiles_owner_user_id_name_unique';

/** Why a change may not put these credentials in the profile's parts (`credentialRefusal`), read as the owner. */
async function choiceRefusal(o: OwnedDb, before: Partial<ProfileFields>, change: ProfileChange) {
  const putIn = partsPutIn(before, change);
  if (putIn.length === 0) return undefined;
  const held = await repo.credentialsOf(
    o,
    putIn.map(([, id]) => id),
  );
  const found = new Map(held.map((row) => [row.id, row]));
  for (const [slot, id] of putIn) {
    const refusal = credentialRefusal(slot, found.get(id));
    if (refusal) return refusal;
  }
  return undefined;
}

/** Why a change may not make its AI parts run what it sets (`runsRefusal`, each part against its provider). */
function runsRefused(before: AccessProfile | undefined, set: ProfileChange) {
  for (const [provider, runs] of runsAfterChange(before, set)) {
    const refusal = runsRefusal(provider, runs);
    if (refusal) return refusal;
  }
  return undefined;
}

/** Why a change may not remove the AI parts it removes: agents run on them (`partInUse`, naming them). */
function removalRefused(before: AccessProfile, set: ProfileChange, users: readonly ProfileUser[]) {
  for (const provider of removedAiParts(before, set)) {
    const running = users.filter((user) => HARNESS_PROVIDER[user.harness] === provider);
    if (running.length > 0)
      return partInUse(
        provider,
        running.map((user) => user.agentName),
      );
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

/** The caller's profiles, oldest first, with their parts and the agents using each. */
async function listProfiles(deps: Deps, caller: Caller): Promise<AccessProfileView[]> {
  const o = owned(deps.db, caller.userId);
  const rows = await repo.listProfiles(o);
  const uses = await agentsByProfile(
    deps.db,
    caller.userId,
    rows.map((row) => row.id),
  );
  return views(o, rows, uses);
}

/**
 * A new profile of the caller's: its name (unique, 409) and the parts given (`partColumns`), one AI part at most (422
 * `one_ai_part`), their credentials checked against each place (422) and its AI part's model and effort against its
 * provider (422).
 */
async function createProfile(
  deps: Deps,
  caller: Caller,
  body: CreateAccessProfile,
): Promise<Saved<409 | 422>> {
  const set = partColumns(undefined, body.parts);
  const refused = secondAiPart(undefined, set) ?? runsRefused(undefined, set);
  if (refused) return refused;
  const saved = await namedWrite(body.name, () =>
    owned(deps.db, caller.userId).transaction(async (o) => {
      const refusal = await choiceRefusal(o, {}, set);
      if (refusal) return refusal;
      const row = await repo.insertProfile(o, { name: body.name, ...set });
      await o.audit(entry(caller, row.id, 'create', diffFields(null, auditedProfile(row))));
      return row;
    }),
  );
  return 'ok' in saved ? saved : shown(deps.db, caller, saved);
}

/**
 * Renames one of the caller's profiles or adds, changes or removes its parts (`partColumns`): the credentials each
 * place takes (`credentialRefusal`), one AI part at most (422 `one_ai_part`), a model and effort each AI part may run
 * (`runsRefusal`), and never removing an AI part agents run on (422 `profile_part_in_use`, naming them: the agents are read before the transaction). Only what
 * differs is written and audited.
 */
async function updateProfile(
  deps: Deps,
  caller: Caller,
  change: { readonly profileId: string; readonly patch: UpdateAccessProfile },
): Promise<Saved<404 | 409 | 422>> {
  const { profileId, patch } = change;
  const removing = patch.parts?.claude === null || patch.parts?.openai === null;
  const users = removing
    ? ((await agentsByProfile(deps.db, caller.userId, [profileId])).get(profileId) ?? [])
    : [];
  const saved = await namedWrite(patch.name, () =>
    owned(deps.db, caller.userId).transaction(async (o) => {
      const row = await repo.getProfile(o, profileId);
      if (row === undefined) return PROFILE_NOT_FOUND;
      const wanted = {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...partColumns(row, patch.parts),
      };
      const refusal = await choiceRefusal(o, row, wanted);
      if (refusal) return refusal;
      const set = profileChanges(row, wanted);
      if (Object.keys(set).length === 0) return row;
      const refused = secondAiPart(row, set) ?? removalRefused(row, set, users) ?? runsRefused(row, set);
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
 * The profiles API's logic (S3.4; generic since 2026-11-13), always as the caller (the personal layer): list their
 * profiles, create one, change one, remove one. A profile is a name and optional parts: a Claude or an OpenAI part, not
 * both (one of the caller's subscriptions of that provider, any of their gateways, never a revoked one, a model of that
 * provider and an effort it takes) and a GitHub and an Atlassian part (one of their sign-ins of that tool and its
 * rights); 422 otherwise; an AI part agents run on is not removed (422). A name is unique among theirs (409); another
 * person's profile is the same 404 as none. Every change writes its `access_profile` audit rows; removing one also
 * writes, in each of the caller's companies, the rows of the agents and defaults it leaves (the org module's
 * `auditProfileRemoval`), before the foreign keys detach it.
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
