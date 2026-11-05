import {
  type AccessProfile,
  type DbHandle,
  diffFields,
  isUniqueViolation,
  type OwnedDb,
  owned,
  tenant,
} from '@mwc/db';
import { companiesOf } from '../../identity/service.ts';
import { agentsUsingProfiles, auditProfileRemoval } from '../../org/service.ts';
import { profileRows as repo } from '../repo/profiles.ts';
import {
  auditedProfile,
  PROFILE_NOT_FOUND,
  type ProfileRefusal,
  profileChanges,
  profileNameTaken,
  type SlotChoice,
  slotRefusal,
  slotsPutIn,
} from '../rules/profiles.ts';
import type {
  AccessProfileView,
  CreateAccessProfile,
  ProfileAgentView,
  SlotSubscriptionView,
  UpdateAccessProfile,
} from '../schemas/profiles.ts';
import type { Caller } from '../service.ts';

type Saved<S extends 404 | 409 | 422> =
  | { readonly ok: true; readonly profile: AccessProfileView }
  | ProfileRefusal<S>;

const NAME_UNIQUE = 'access_profiles_owner_user_id_name_unique';

/** The companies a person belongs to (not removed, not deleted), as `GET /api/me` lists them. */
const companiesOfUser = (db: DbHandle, userId: string) =>
  companiesOf(db, { kind: 'user', via: 'clerk', userId });

/**
 * The agents that use each of these profiles, in the owner's companies (an agent with one of their profiles is in a
 * company they belong to: leaving one takes their profiles off its agents), by profile id.
 */
async function agentsByProfile(db: DbHandle, userId: string, profileIds: readonly string[]) {
  const uses = new Map<string, ProfileAgentView[]>();
  if (profileIds.length === 0) return uses;
  for (const company of await companiesOfUser(db, userId)) {
    for (const use of await agentsUsingProfiles(await tenant(db, company.companyId), profileIds)) {
      const agent = {
        companyId: company.companyId,
        companySlug: company.slug,
        companyName: company.name,
        agentId: use.agentId,
        agentName: use.name,
        agentSlug: use.slug,
      };
      uses.set(use.profileId, [...(uses.get(use.profileId) ?? []), agent]);
    }
  }
  return uses;
}

const slotsOf = (row: AccessProfile) => [
  row.claudeCredentialId,
  row.openaiCredentialId,
  row.gatewayCredentialId,
];

/** Profiles as the API shows them: each slot's subscription as metadata (never a secret) and the agents using it. */
async function views(
  o: OwnedDb,
  rows: readonly AccessProfile[],
  uses: ReadonlyMap<string, ProfileAgentView[]>,
): Promise<AccessProfileView[]> {
  const slotIds = rows.flatMap(slotsOf).filter((id) => id !== null);
  const held = new Map<string, SlotSubscriptionView>();
  for (const credential of await repo.credentialsOf(o, slotIds)) {
    const { id, kind, label, accountEmail, status } = credential;
    held.set(id, { id, kind, label, accountEmail, status });
  }
  const slotView = (id: string | null) => (id === null ? null : (held.get(id) ?? null));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    claude: slotView(row.claudeCredentialId),
    openai: slotView(row.openaiCredentialId),
    gateway: slotView(row.gatewayCredentialId),
    agents: uses.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** Why a change may not put its credentials in the profile's slots (`slotRefusal`), read as the owner. */
async function slotsRefusal(o: OwnedDb, before: Parameters<typeof slotsPutIn>[0], choice: SlotChoice) {
  const putIn = slotsPutIn(before, choice);
  if (putIn.length === 0) return undefined;
  const held = await repo.credentialsOf(
    o,
    putIn.map(([, id]) => id),
  );
  const found = new Map(held.map((row) => [row.id, row]));
  for (const [slot, id] of putIn) {
    const refusal = slotRefusal(slot, found.get(id));
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

/** The caller's profiles, oldest first, with their slots and the agents using each. */
async function listProfiles(deps: Deps, caller: Caller): Promise<AccessProfileView[]> {
  const o = owned(deps.db, caller.userId);
  const rows = await repo.listProfiles(o);
  const ids = rows.map((row) => row.id);
  const uses = await agentsByProfile(deps.db, caller.userId, ids);
  return views(o, rows, uses);
}

/** A new profile of the caller's, its slots checked (422) and its name unique among theirs (409). */
async function createProfile(
  deps: Deps,
  caller: Caller,
  body: CreateAccessProfile,
): Promise<Saved<409 | 422>> {
  const saved = await namedWrite(body.name, () =>
    owned(deps.db, caller.userId).transaction(async (o) => {
      const refusal = await slotsRefusal(o, {}, body);
      if (refusal) return refusal;
      const { name, claudeCredentialId, openaiCredentialId, gatewayCredentialId } = body;
      const slots = { claudeCredentialId, openaiCredentialId, gatewayCredentialId };
      const row = await repo.insertProfile(o, { ...slots, name });
      await o.audit(entry(caller, row.id, 'create', diffFields(null, auditedProfile(row))));
      return row;
    }),
  );
  return 'ok' in saved ? saved : shown(deps.db, caller, saved);
}

/** Renames one of the caller's profiles or changes its slots; only what differs is written and audited. */
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
      const refusal = await slotsRefusal(o, row, patch);
      if (refusal) return refusal;
      const set = profileChanges(row, patch);
      if (Object.keys(set).length === 0) return row;
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
 * The access profiles API's logic (S3.4), always as the caller (the personal layer): list their profiles, create one,
 * change one, remove one. A slot takes one of the caller's own subscriptions of a kind it fits, never a revoked one
 * (422); a name is unique among theirs (409); another person's profile is the same 404 as none. Every change writes
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
