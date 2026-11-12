import type { Agent, TenantDb } from '@mwc/db';
import { TOOL_PROVIDERS } from '@mwc/shared/credentials';
import { TOOL_COLUMNS } from '../../repo/profiles.ts';
import { profileStep, toolProfileMismatch } from '../../rules/agents.ts';
import type { Caller } from '../audit.ts';
import type { Given, ProfileRepo } from '../profiles.ts';
import { giveCheck } from './give.ts';

// Giving tool profiles (S7.1b): an agent's GitHub and Atlassian profiles follow the rules of its AI profile (only their
// owner gives one, signed in, as an admin or owner here; any admin or owner takes one off), with no default and no
// harness to fit: a GitHub profile goes in `githubProfileId`, an Atlassian one in `atlassianProfileId`.

/** An agent's tool profiles as a change asks for them: a profile id, null to take one off, or left out to keep it. */
export type ToolChoice = {
  readonly [C in (typeof TOOL_COLUMNS)[keyof typeof TOOL_COLUMNS]]?: string | null | undefined;
};

/** What a change writes to an agent's tool profile columns. */
export type ToolSet = { -readonly [C in keyof ToolChoice]?: string | null };

/**
 * What a change does to an agent's tool profiles (a new agent has none yet): for each tool, give the one asked for
 * (only the caller's own, `giveRefusal`, of that tool, else 422 `profile_provider_mismatch`), take it off (any admin or
 * owner), or keep it. The first refusal ends it.
 */
export async function toolProfilesChange(
  repo: ProfileRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly agent: Pick<Agent, keyof ToolChoice> | undefined; readonly requested: ToolChoice },
): Promise<Given<{ readonly set: ToolSet }>> {
  const set: ToolSet = {};
  for (const tool of TOOL_PROVIDERS) {
    const column = TOOL_COLUMNS[tool];
    const requested = change.requested[column];
    const step = profileStep(change.agent?.[column] ?? null, requested);
    if (step === 'remove') set[column] = null;
    if (step !== 'give') continue;
    const profileId = requested as string;
    const mismatch = (provider: Parameters<typeof toolProfileMismatch>[0]) =>
      toolProfileMismatch(provider, tool);
    const refusal = await giveCheck(repo, t, caller, { profileId, provider: tool, mismatch });
    if (refusal) return refusal;
    set[column] = profileId;
  }
  return { ok: true, set };
}
