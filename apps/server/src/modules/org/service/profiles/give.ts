import { type Agent, diffFields, type Membership, type TenantDb } from '@mwc/db';
import { HARNESS_PROVIDER, profileFitsHarness } from '@mwc/shared/credentials';
import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import { DEFAULT_COLUMNS } from '../../repo/profiles.ts';
import {
  defaultProviderMismatch,
  giveRefusal,
  profileClearedMessage,
  profileHarnessMismatch,
  profileStep,
} from '../../rules/agents.ts';
import type { DefaultProfileView, ProfileClearedView } from '../../schemas/profiles.ts';
import { auditEntry, type Caller } from '../audit.ts';
import type { Given, ProfileRepo } from '../profiles.ts';

// Giving access profiles (S3.4, one provider each since 2026-11-10): to an agent (only its owner's, of the provider its
// harness runs on), what a change of the agent's harness does to the one it has, and a member's default of each
// provider for the agents they hire.

/**
 * Why the caller may not give this profile where a `provider` profile goes (`giveRefusal`, then `mismatch` for one of
 * the other provider), read in the caller's transaction; undefined when they may.
 */
async function giveCheck(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  wanted: {
    readonly profileId: string;
    readonly provider: ProfileProvider;
    readonly mismatch: (provider: ProfileProvider) => ReturnType<typeof profileHarnessMismatch>;
  },
) {
  const row = await repo.profileRow(t, wanted.profileId);
  const refusal = giveRefusal(caller, row?.ownerUserId);
  if (refusal) return refusal;
  const { provider } = row as NonNullable<typeof row>;
  return provider === wanted.provider ? undefined : wanted.mismatch(provider);
}

/** Why the caller may not give this profile to an agent on `harness` (`giveCheck`); undefined when they may. */
const giveToAgent = (repo: ProfileRepo, t: TenantDb, caller: Caller, profileId: string, harness: Harness) =>
  giveCheck(repo, t, caller, {
    profileId,
    provider: HARNESS_PROVIDER[harness],
    mismatch: (provider) => profileHarnessMismatch(provider, harness),
  });

/**
 * The profile a new agent on `harness` gets: the one asked for (only the caller's own, `giveRefusal`, of the harness's
 * provider, else 422 `profile_harness_mismatch`), none for null, or the caller's default of that provider in the
 * company when it is left out.
 */
export async function newAgentProfile(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  wanted: { readonly requested: string | null | undefined; readonly harness: Harness },
): Promise<Given<{ readonly profileId: string | null }>> {
  const { requested, harness } = wanted;
  if (requested === undefined) {
    const membership = (await repo.membershipOf(t, caller.principalId)) as Membership;
    return { ok: true, profileId: membership[DEFAULT_COLUMNS[HARNESS_PROVIDER[harness]]] };
  }
  if (requested === null) return { ok: true, profileId: null };
  return (await giveToAgent(repo, t, caller, requested, harness)) ?? { ok: true, profileId: requested };
}

type Change = Given<{
  readonly set: { profileId?: string | null };
  readonly profileCleared?: ProfileClearedView;
}>;

/**
 * What a harness change does to the profile an agent keeps (the change names none, or the same one): nothing when it
 * fits the new harness; when it does not, the change takes it off with a note (`profileCleared`), or is refused (422
 * `profile_harness_mismatch`) when it named that profile.
 */
async function harnessChange(
  repo: ProfileRepo,
  t: TenantDb,
  change: { readonly agent: Agent; readonly requested: string | null | undefined; readonly harness: Harness },
): Promise<Change> {
  const { agent, harness } = change;
  if (agent.profileId === null || harness === agent.harness) return { ok: true, set: {} };
  // The agent's profile exists: removing one takes it off its agents (`on delete set null`).
  const row = (await repo.profileRow(t, agent.profileId)) as NonNullable<
    Awaited<ReturnType<ProfileRepo['profileRow']>>
  >;
  if (profileFitsHarness(row.provider, harness)) return { ok: true, set: {} };
  if (change.requested === agent.profileId) return profileHarnessMismatch(row.provider, harness);
  const message = profileClearedMessage(row.name, row.provider, harness);
  return {
    ok: true,
    set: { profileId: null },
    profileCleared: { profileId: row.id, name: row.name, message },
  };
}

/**
 * What a change does to an agent's profile: give one (only the caller's own, `giveRefusal`, of the provider of the
 * harness the agent has after the change), take it off (any admin or owner), or keep it, which a harness change it no
 * longer fits turns into taking it off (`harnessChange`).
 */
export async function profileChange(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  change: {
    readonly agent: Agent;
    readonly requested: string | null | undefined;
    readonly harness?: Harness | undefined;
  },
): Promise<Change> {
  const harness = change.harness ?? change.agent.harness;
  const step = profileStep(change.agent.profileId, change.requested);
  if (step === 'none') return harnessChange(repo, t, { ...change, harness });
  if (step === 'remove') return { ok: true, set: { profileId: null } };
  const profileId = change.requested as string;
  return (await giveToAgent(repo, t, caller, profileId, harness)) ?? { ok: true, set: { profileId } };
}

/** A membership's defaults, as the API shows them. */
const defaultsOf = (membership: Membership): DefaultProfileView => ({
  defaultClaudeProfileId: membership.defaultClaudeProfileId,
  defaultOpenaiProfileId: membership.defaultOpenaiProfileId,
});

/**
 * Sets the caller's own default profile of one provider in the company, for the agents they hire on its harness, in one
 * transaction under the company's lock: null clears it (any active member); a profile must be the caller's own, given
 * signed in as an admin or owner (`giveRefusal`), of that provider (422 `provider_mismatch`). The same value writes
 * nothing; a change writes its `membership` audit row.
 */
export function setDefaultProfile(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  choice: { readonly provider: ProfileProvider; readonly profileId: string | null },
): Promise<Given<{ readonly value: DefaultProfileView }>> {
  const { provider, profileId } = choice;
  const field = DEFAULT_COLUMNS[provider];
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const membership = (await repo.membershipOf(tx, caller.principalId)) as Membership;
    const before = membership[field];
    const step = profileStep(before, profileId);
    if (step === 'none') return { ok: true as const, value: defaultsOf(membership) };
    if (step === 'give') {
      const mismatch = (other: ProfileProvider) => defaultProviderMismatch(other, provider);
      const refusal = await giveCheck(repo, tx, caller, {
        profileId: profileId as string,
        provider,
        mismatch,
      });
      if (refusal) return refusal;
    }
    const after = await repo.setDefaultProfile(tx, membership.id, provider, profileId);
    await repo.audit(tx, {
      ...auditEntry(caller, 'membership', membership.id, 'update'),
      changes: diffFields({ [field]: before }, { [field]: after[field] }),
    });
    return { ok: true as const, value: defaultsOf(after) };
  });
}
