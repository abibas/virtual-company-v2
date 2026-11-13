import type { AccessProfile, AgentDetail } from '../../api/types.ts';
import { profileAiPart, type RunsWith } from '../../components/org/agent-labels.ts';

/**
 * What a profile runs for an agent (since 2026-11-13 a profile has one AI part at most, and the agent's harness follows
 * it): that part's model, effort and mode. The agent form asks for none of them; the profile's part decides. Pure.
 */

/**
 * What the draft's profile runs: one of the person's own (`mine`, once loaded), the agent's (someone else's, as the
 * agent shows it), null for none or a profile without an AI part, or undefined while it is not known yet.
 */
export function runsOf(
  profileId: string | null,
  mine: readonly AccessProfile[] | undefined,
  agent?: AgentDetail,
): RunsWith | null | undefined {
  if (profileId === null) return null;
  const own = mine?.find((profile) => profile.id === profileId);
  if (own) {
    const provider = profileAiPart(own);
    const part = provider && own.parts[provider];
    return provider && part ? { model: part.model, effort: part.effort, mode: part.mode, provider } : null;
  }
  return agent?.profile?.id === profileId ? agent.runsWith : undefined;
}
