import { isAgentEmoji } from '@mwc/shared/agent-icons';
import type { AgentIconCalls } from '../../api/images/agent-icon.ts';
import type { AgentDetail, AgentIconChoice } from '../../api/types.ts';
import type { PreparedLogo } from '../../components/forms/image/logo-file.ts';

/**
 * The agent form's icon (docs/architecture.md, "Agent icons"): its drawn face, an emoji, or an image, either the one it
 * has (`pending` null) or one picked and cropped here, uploaded on Save or Hire.
 */
export type IconDraft =
  | { readonly kind: 'face' }
  | { readonly kind: 'emoji'; readonly emoji: string }
  | { readonly kind: 'image'; readonly pending: PreparedLogo | null };

/** The icon the form starts from: the agent's own, or the face for a new one. */
export function iconStart(agent: AgentDetail | undefined): IconDraft {
  const icon = agent?.icon;
  if (icon?.kind === 'emoji') return { kind: 'emoji', emoji: icon.emoji };
  if (icon?.kind === 'image') return { kind: 'image', pending: null };
  return { kind: 'face' };
}

/** Whether the agent has an image saved already. */
const hasImage = (agent: AgentDetail | undefined) => agent?.icon.kind === 'image';

/** Whether Save may send the icon: one emoji, or an image picked or saved already. */
export function iconValid(icon: IconDraft, agent: AgentDetail | undefined): boolean {
  if (icon.kind === 'emoji') return isAgentEmoji(icon.emoji.trim());
  if (icon.kind === 'image') return icon.pending !== null || hasImage(agent);
  return true;
}

/** What Save (or Hire) sends for the icon: nothing, a choice of the face or an emoji, or an image to upload. */
export type IconStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'choose'; readonly choice: AgentIconChoice }
  | { readonly kind: 'upload'; readonly blob: Blob };

const NONE: IconStep = { kind: 'none' };

/** The icon's step against the saved agent (a new one wears its face): only what changed is sent. */
export function iconStep(icon: IconDraft, agent: AgentDetail | undefined): IconStep {
  const saved = agent?.icon ?? { kind: 'face' as const };
  if (icon.kind === 'image') return icon.pending ? { kind: 'upload', blob: icon.pending.blob } : NONE;
  if (icon.kind === 'emoji') {
    const emoji = icon.emoji.trim();
    const same = saved.kind === 'emoji' && saved.emoji === emoji;
    return same ? NONE : { kind: 'choose', choice: { kind: 'emoji', emoji } };
  }
  return saved.kind === 'face' ? NONE : { kind: 'choose', choice: { kind: 'face' } };
}

/** Sends the icon's step for the agent. */
export async function saveIcon(calls: AgentIconCalls, agentId: string, step: IconStep): Promise<void> {
  if (step.kind === 'choose') await calls.choose(agentId, step.choice);
  if (step.kind === 'upload') await calls.upload(agentId, step.blob);
}

/** A new agent's icon, when it is not its face; hired already, so a refusal here is chosen again on its page. */
export async function saveNewIcon(calls: AgentIconCalls, agentId: string, icon: IconDraft): Promise<void> {
  await saveIcon(calls, agentId, iconStep(icon, undefined)).catch(() => undefined);
}

/** A short key of the agent's saved icon: the agent's page starts its form again when it changes. */
export function iconKey(agent: AgentDetail): string {
  const { icon } = agent;
  if (icon.kind === 'emoji') return `emoji:${icon.emoji}`;
  return icon.kind === 'image' ? `image:${icon.version}` : 'face';
}
