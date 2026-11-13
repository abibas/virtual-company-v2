import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { Harness } from '@mwc/shared/enums';
import type { AccessProfile, AgentDetail } from '../../api/types.ts';
import type { RunsWith } from '../../components/org/agent-labels.ts';

/**
 * What a profile runs for an agent (generic profiles since 2026-11-13): the model and effort of its part for the agent's
 * harness (a Claude part for Claude Code, an OpenAI part for Codex). The agent form asks for neither; the profile's part
 * decides them. Pure.
 */

/**
 * What the draft's profile runs on `harness`: one of the person's own (`mine`, once loaded), the agent's (someone
 * else's, as the agent shows it), null for none or a profile without that part, or undefined while it is not known yet.
 */
export function runsOf(
  profileId: string | null,
  harness: Harness,
  mine: readonly AccessProfile[] | undefined,
  agent?: AgentDetail,
): RunsWith | null | undefined {
  if (profileId === null) return null;
  const provider = HARNESS_PROVIDER[harness];
  const own = mine?.find((profile) => profile.id === profileId);
  if (own) {
    const part = own.parts[provider];
    return part ? { model: part.model, effort: part.effort, provider } : null;
  }
  return agent?.profile?.id === profileId && agent.harness === harness ? agent.runsWith : undefined;
}
