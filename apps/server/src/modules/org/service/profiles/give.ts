import { type Agent, aiPartOf, diffFields, type Membership, type TenantDb } from '@mwc/db';
import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import { AGENT_DEFAULTS } from '@mwc/shared/org';
import { DEFAULT_COLUMNS } from '../../repo/profiles.ts';
import {
  defaultPartMissing,
  giveRefusal,
  PROFILE_NO_AI_PART,
  profileHarness,
  profileStep,
} from '../../rules/agents.ts';
import type { DefaultProfileView } from '../../schemas/profiles.ts';
import { auditEntry, type Caller } from '../audit.ts';
import type { Given, ProfileRepo } from '../profiles.ts';

// Giving access profiles (S3.4; generic profiles since 2026-11-13): to an agent (only its owner's, with an AI part,
// which sets the agent's harness: Claude Code for a Claude part, Codex for an OpenAI part), and a member's default for
// the agents of each part they hire.

/** The profile row of an id, whoever owns it; undefined when there is none. */
type ProfileRow = NonNullable<Awaited<ReturnType<ProfileRepo['profileRow']>>>;

/** Why the caller may not give this profile (`giveRefusal`), read in the caller's transaction, or its row. */
async function givable(repo: ProfileRepo, t: TenantDb, caller: Caller, profileId: string) {
  const row = await repo.profileRow(t, profileId);
  return giveRefusal(caller, row?.ownerUserId) ?? (row as ProfileRow);
}

/**
 * Why the caller may not give this profile to an agent (`giveRefusal`, then 422 `profile_no_ai_part` for a profile
 * with neither AI part), or the harness it gives the agent.
 */
async function giveToAgent(repo: ProfileRepo, t: TenantDb, caller: Caller, profileId: string) {
  const row = await givable(repo, t, caller, profileId);
  if ('ok' in row) return row;
  const harness = profileHarness(row);
  return harness === undefined ? PROFILE_NO_AI_PART : { ok: true as const, harness };
}

/** The caller's default here for one AI part's agents, when it still has that part (else none). */
async function defaultFor(repo: ProfileRepo, t: TenantDb, membership: Membership, provider: ProfileProvider) {
  const profileId = membership[DEFAULT_COLUMNS[provider]];
  if (profileId === null) return null;
  const row = await repo.profileRow(t, profileId);
  return row && aiPartOf(row, provider) ? row : null;
}

/** A new agent's profile and the harness it runs on. */
type NewProfile = Given<{ readonly profileId: string | null; readonly harness: Harness }>;

/** No profile: the agent keeps the default harness until it is given one. */
const NO_PROFILE = { ok: true, profileId: null, harness: AGENT_DEFAULTS.harness } as const;

/**
 * The profile a new agent gets and the harness that follows from it: the one asked for (only the caller's own,
 * `giveRefusal`, with an AI part, else 422 `profile_no_ai_part`), none for null, or, left out, the caller's default
 * here for Claude Code agents, else their default for Codex agents (each only while it still has that part), else none.
 * An agent without a profile gets the default harness, Claude Code.
 */
export async function newAgentProfile(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  requested: string | null | undefined,
): Promise<NewProfile> {
  if (requested === null) return NO_PROFILE;
  if (requested === undefined) {
    const membership = (await repo.membershipOf(t, caller.principalId)) as Membership;
    const chosen =
      (await defaultFor(repo, t, membership, 'claude')) ?? (await defaultFor(repo, t, membership, 'openai'));
    if (chosen === null) return NO_PROFILE;
    return { ok: true, profileId: chosen.id, harness: profileHarness(chosen) as Harness };
  }
  const given = await giveToAgent(repo, t, caller, requested);
  return given.ok ? { ok: true, profileId: requested, harness: given.harness } : given;
}

type Change = Given<{ readonly set: { profileId?: string | null; harness?: Harness } }>;

/**
 * What a change does to an agent's profile and, through it, its harness: give one (only the caller's own,
 * `giveRefusal`, with an AI part, else 422 `profile_no_ai_part`), which sets the harness from its AI part; take it off
 * (any admin or owner), which keeps the harness; or keep it. A new harness leaves the agent's chats as they were: each
 * keeps the harness it began on, and its next turn says `harness_changed` (start a new chat).
 */
export async function profileChange(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly agent: Agent; readonly requested: string | null | undefined },
): Promise<Change> {
  const step = profileStep(change.agent.profileId, change.requested);
  if (step === 'none') return { ok: true, set: {} };
  if (step === 'remove') return { ok: true, set: { profileId: null } };
  const profileId = change.requested as string;
  const given = await giveToAgent(repo, t, caller, profileId);
  if (!given.ok) return given;
  const harness = given.harness === change.agent.harness ? {} : { harness: given.harness };
  return { ok: true, set: { profileId, ...harness } };
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
      const row = await givable(repo, tx, caller, profileId as string);
      if ('ok' in row) return row;
      if (!aiPartOf(row, provider)) return defaultPartMissing(provider);
    }
    const after = await repo.setDefaultProfile(tx, membership.id, provider, profileId);
    await repo.audit(tx, {
      ...auditEntry(caller, 'membership', membership.id, 'update'),
      changes: diffFields({ [field]: before }, { [field]: after[field] }),
    });
    return { ok: true as const, value: defaultsOf(after) };
  });
}
