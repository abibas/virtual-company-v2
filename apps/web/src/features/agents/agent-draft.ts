import type { Harness, ProfileProvider } from '@mwc/shared/enums';
import {
  AGENT_DEFAULTS,
  AGENT_INSTRUCTIONS_MAX,
  AGENT_NAME,
  AGENT_ROLE_TITLE,
  agentFace,
} from '@mwc/shared/org';
import { slugify } from '@mwc/shared/slugs';
import { useState } from 'react';
import type { AgentChanges, AgentDetail, NewAgent } from '../../api/types.ts';
import { type IconDraft, iconStart, iconValid } from './icon-draft.ts';

/** What the agent form holds. */
export interface AgentValues {
  readonly name: string;
  readonly roleTitle: string;
  /** The face picked; null follows the face of the slug the name makes. */
  readonly face: number | null;
  /** What stands for it: its face, an emoji or an image (`icon-draft.ts`), sent apart from the fields. */
  readonly icon: IconDraft;
  /**
   * What runs it: its profile's AI part's harness, set with the profile (the server sets it the same way); its model
   * and effort are the profile's too.
   */
  readonly harness: Harness;
  readonly maxConcurrentRuns: number;
  /** The manager's principal id. */
  readonly reportsTo: string;
  readonly instructions: string;
  /** The access profile its runs use (the signed-in person's, or another's it already has); null for none. */
  readonly profileId: string | null;
}

/** The hirer's default access profile of each provider in the company (the hire form only). */
export type ProfileDefaults = Readonly<Record<ProfileProvider, string | null>>;

export interface AgentDraft {
  readonly values: AgentValues;
  set<K extends keyof AgentValues>(key: K, value: AgentValues[K]): void;
  /** The slug the name makes, as the server derives it for a new agent. */
  readonly slug: string;
  /** The face on show: the one picked, else the slug's. */
  readonly face: number;
  /** Every field within the API's limits. */
  readonly valid: boolean;
  /** Back to the start (the saved agent, or a new one's defaults). */
  reset(): void;
}

const within = (text: string, limits: { readonly min: number; readonly max: number }) =>
  text.trim().length >= limits.min && text.trim().length <= limits.max;

/** Where a new agent starts: the hirer's Claude default, else their OpenAI one (as the server picks), or none. */
interface Start {
  readonly profileId: string | null;
  readonly harness: Harness;
}

function startFrom(defaults: ProfileDefaults | undefined): Start {
  if (defaults?.claude) return { profileId: defaults.claude, harness: 'claude_code' };
  if (defaults?.openai) return { profileId: defaults.openai, harness: 'codex' };
  return { profileId: null, harness: AGENT_DEFAULTS.harness };
}

/** The form's start: the agent's own values, or a new agent's defaults under `reportsTo` from `start`. */
function startOf(agent: AgentDetail | undefined, reportsTo: string, start: Start): AgentValues {
  return {
    name: agent?.name ?? '',
    roleTitle: agent?.roleTitle ?? '',
    face: agent?.face ?? null,
    icon: iconStart(agent),
    harness: agent?.harness ?? start.harness,
    maxConcurrentRuns: agent?.maxConcurrentRuns ?? AGENT_DEFAULTS.maxConcurrentRuns,
    // An archived agent has no place (and no manager) until it is restored.
    reportsTo: agent ? (agent.reportsTo ?? '') : reportsTo,
    instructions: agent?.instructions ?? AGENT_DEFAULTS.instructions,
    profileId: agent ? (agent.profile?.id ?? null) : start.profileId,
  };
}

/**
 * The agent form's state: its values, the slug and face they lead to, and whether the API would take them. A new
 * agent starts with the hirer's Claude default profile, else their OpenAI one (`profileDefaults`), and its harness.
 */
export function useAgentDraft(
  agent: AgentDetail | undefined,
  reportsTo: string,
  profileDefaults?: ProfileDefaults,
): AgentDraft {
  const start = startFrom(profileDefaults);
  const [values, setValues] = useState(() => startOf(agent, reportsTo, start));
  const slug = slugify(values.name, 'agent');
  return {
    values,
    set: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    slug,
    face: values.face ?? agentFace(slug),
    valid:
      within(values.name, AGENT_NAME) &&
      within(values.roleTitle, AGENT_ROLE_TITLE) &&
      values.instructions.length <= AGENT_INSTRUCTIONS_MAX &&
      iconValid(values.icon, agent),
    reset: () => setValues(startOf(agent, reportsTo, start)),
  };
}

/**
 * The new agent as `POST /agents` takes it: every field, the face as shown, its manager and its access profile (whose
 * AI part sets its harness on the server).
 */
export function newAgentOf(draft: AgentDraft): NewAgent {
  const { values } = draft;
  return {
    name: values.name.trim(),
    roleTitle: values.roleTitle.trim(),
    face: draft.face,
    maxConcurrentRuns: values.maxConcurrentRuns,
    instructions: values.instructions,
    reportsToPrincipalId: values.reportsTo,
    profileId: values.profileId,
  };
}

/** The fields that differ from the saved agent, as `PATCH /agents/:id` takes them (its place moves separately). */
export function changesOf(draft: AgentDraft, agent: AgentDetail): Partial<AgentChanges> {
  const { values } = draft;
  const next = {
    name: values.name.trim(),
    roleTitle: values.roleTitle.trim(),
    face: draft.face,
    maxConcurrentRuns: values.maxConcurrentRuns,
    instructions: values.instructions,
  };
  const changed = Object.fromEntries(
    Object.entries(next).filter(([key, value]) => agent[key as keyof typeof next] !== value),
  ) as Partial<AgentChanges>;
  const profileId = agent.profile?.id ?? null;
  return values.profileId === profileId ? changed : { ...changed, profileId: values.profileId };
}
