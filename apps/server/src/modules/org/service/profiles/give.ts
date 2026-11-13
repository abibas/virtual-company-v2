import { type Agent, aiPartOf, diffFields, type Membership, type TenantDb } from '@mwc/db';
import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import { DEFAULT_COLUMNS } from '../../repo/profiles.ts';
import { defaultPartMissing, giveRefusal, profilePartMissing, profileStep } from '../../rules/agents.ts';
import type { DefaultProfileView } from '../../schemas/profiles.ts';
import { auditEntry, type Caller } from '../audit.ts';
import type { Given, ProfileRepo } from '../profiles.ts';

// Giving access profiles (S3.4; generic profiles since 2026-11-13): to an agent (only its owner's, with the AI part its
// harness runs on: a Claude part for Claude Code, an OpenAI part for Codex), what a change of the agent's harness asks
// of the one it has, and a member's default for the agents of each part they hire.

/** The profile row of an id, whoever owns it; undefined when there is none. */
type ProfileRow = Awaited<ReturnType<ProfileRepo['profileRow']>>;

/**
 * Why the caller may not give this profile where a `provider` part is needed (`giveRefusal`, then `missing` for a
 * profile without that part), read in the caller's transaction; undefined when they may.
 */
async function giveCheck(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  wanted: {
    readonly profileId: string;
    readonly provider: ProfileProvider;
    readonly missing: () => ReturnType<typeof profilePartMissing>;
  },
) {
  const row = await repo.profileRow(t, wanted.profileId);
  const refusal = giveRefusal(caller, row?.ownerUserId);
  if (refusal) return refusal;
  return aiPartOf(row as NonNullable<ProfileRow>, wanted.provider) ? undefined : wanted.missing();
}

/** Why the caller may not give this profile to an agent on `harness` (`giveCheck`); undefined when they may. */
const giveToAgent = (repo: ProfileRepo, t: TenantDb, caller: Caller, profileId: string, harness: Harness) =>
  giveCheck(repo, t, caller, {
    profileId,
    provider: HARNESS_PROVIDER[harness],
    missing: () => profilePartMissing(harness),
  });

/** The caller's default here for agents on `harness`, when it still has that part (else none). */
async function defaultFor(repo: ProfileRepo, t: TenantDb, caller: Caller, harness: Harness) {
  const membership = (await repo.membershipOf(t, caller.principalId)) as Membership;
  const provider = HARNESS_PROVIDER[harness];
  const profileId = membership[DEFAULT_COLUMNS[provider]];
  if (profileId === null) return null;
  const row = await repo.profileRow(t, profileId);
  return row && aiPartOf(row, provider) ? profileId : null;
}

/**
 * The profile a new agent on `harness` gets: the one asked for (only the caller's own, `giveRefusal`, with the harness's
 * part, else 422 `profile_part_missing`), none for null, or the caller's default here for that harness when it is left
 * out (none when that default lost the part).
 */
export async function newAgentProfile(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  wanted: { readonly requested: string | null | undefined; readonly harness: Harness },
): Promise<Given<{ readonly profileId: string | null }>> {
  const { requested, harness } = wanted;
  if (requested === undefined) return { ok: true, profileId: await defaultFor(repo, t, caller, harness) };
  if (requested === null) return { ok: true, profileId: null };
  return (await giveToAgent(repo, t, caller, requested, harness)) ?? { ok: true, profileId: requested };
}

type Change = Given<{ readonly set: { profileId?: string | null } }>;

/**
 * What a harness change asks of the profile an agent keeps (the change names none, or the same one): nothing when it
 * has the new harness's part; when it does not, the change is refused (422 `profile_part_missing`): take the profile
 * off, or give another, in the same change.
 */
async function harnessChange(
  repo: ProfileRepo,
  t: TenantDb,
  change: { readonly agent: Agent; readonly harness: Harness },
): Promise<Change> {
  const { agent, harness } = change;
  if (agent.profileId === null || harness === agent.harness) return { ok: true, set: {} };
  // The agent's profile exists: removing one takes it off its agents (`on delete set null`).
  const row = (await repo.profileRow(t, agent.profileId)) as NonNullable<ProfileRow>;
  return aiPartOf(row, HARNESS_PROVIDER[harness]) ? { ok: true, set: {} } : profilePartMissing(harness);
}

/**
 * What a change does to an agent's profile: give one (only the caller's own, `giveRefusal`, with the part of the harness
 * the agent has after the change), take it off (any admin or owner), or keep it, which a harness change it has no part
 * for refuses (`harnessChange`).
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
  if (step === 'none') return harnessChange(repo, t, { agent: change.agent, harness });
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
 * Sets the caller's own default profile for one AI part's agents in the company (Claude Code agents for `claude`,
 * Codex agents for `openai`), in one transaction under the company's lock: null clears it (any active member); a
 * profile must be the caller's own, given signed in as an admin or owner (`giveRefusal`), with that part (422
 * `profile_part_missing`). The same value writes nothing; a change writes its `membership` audit row.
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
      const missing = () => defaultPartMissing(provider);
      const refusal = await giveCheck(repo, tx, caller, {
        profileId: profileId as string,
        provider,
        missing,
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
