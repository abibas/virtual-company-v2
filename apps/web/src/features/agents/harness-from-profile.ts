import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import type { AccessProfile, AgentDetail } from '../../api/types.ts';
import type { RunsWith } from '../../components/org/agent-labels.ts';
import type { AgentDraft } from './agent-draft.ts';

/**
 * What a profile decides for an agent: the harness its provider runs today (each provider's own: Claude Code for
 * Claude, Codex for OpenAI), and the model and effort its runs use. The agent form asks for neither; the profile
 * decides them. Pure.
 */
export const PROVIDER_HARNESS: Readonly<Record<ProfileProvider, Harness>> = {
  claude: 'claude_code',
  openai: 'codex',
};

/** Puts the draft on the harness of a picked profile's provider. */
export function followProvider(draft: AgentDraft, provider: ProfileProvider): void {
  const harness = PROVIDER_HARNESS[provider];
  if (draft.values.harness !== harness) draft.set('harness', harness);
}

/**
 * What the draft's profile runs: one of the person's own (`mine`, once loaded), the agent's (someone else's, as the
 * agent shows it), null for none, or undefined while it is not known yet.
 */
export function runsOf(
  profileId: string | null,
  mine: readonly AccessProfile[] | undefined,
  agent?: AgentDetail,
): RunsWith | null | undefined {
  if (profileId === null) return null;
  const own = mine?.find((profile) => profile.id === profileId);
  if (own) return { model: own.model, effort: own.effort, provider: own.provider };
  return agent?.profile?.id === profileId ? agent.runsWith : undefined;
}
