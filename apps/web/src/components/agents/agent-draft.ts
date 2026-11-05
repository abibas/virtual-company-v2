import type { Effort, Harness } from '@mwc/shared/enums';
import {
  AGENT_DEFAULTS,
  AGENT_INSTRUCTIONS_MAX,
  AGENT_MODEL_MAX,
  AGENT_NAME,
  AGENT_ROLE_TITLE,
  agentFace,
} from '@mwc/shared/org';
import { slugify } from '@mwc/shared/slugs';
import { useState } from 'react';
import type { AgentChanges, AgentDetail, NewAgent } from '../../api/types.ts';
import { MODELS } from '../org/agent-labels.ts';

/** What the agent form holds. */
export interface AgentValues {
  readonly name: string;
  readonly roleTitle: string;
  /** The face picked; null follows the face of the slug the name makes. */
  readonly face: number | null;
  readonly model: string;
  /** The model is typed as an id instead of picked from the known ones. */
  readonly customModel: boolean;
  readonly effort: Effort;
  readonly harness: Harness;
  readonly maxConcurrentRuns: number;
  /** The manager's principal id. */
  readonly reportsTo: string;
  readonly instructions: string;
  /** The access profile its runs use (the signed-in person's, or another's it already has); null for none. */
  readonly profileId: string | null;
}

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

/** The form's start: the agent's own values, or a new agent's defaults under `reportsTo` with `profileId`. */
function startOf(agent: AgentDetail | undefined, reportsTo: string, profileId: string | null): AgentValues {
  const model = agent?.model ?? AGENT_DEFAULTS.model;
  return {
    name: agent?.name ?? '',
    roleTitle: agent?.roleTitle ?? '',
    face: agent?.face ?? null,
    model,
    customModel: !MODELS.some((known) => known.value === model),
    effort: agent?.effort ?? AGENT_DEFAULTS.effort,
    harness: agent?.harness ?? AGENT_DEFAULTS.harness,
    maxConcurrentRuns: agent?.maxConcurrentRuns ?? AGENT_DEFAULTS.maxConcurrentRuns,
    // An archived agent has no place (and no manager) until it is restored.
    reportsTo: agent ? (agent.reportsTo ?? '') : reportsTo,
    instructions: agent?.instructions ?? AGENT_DEFAULTS.instructions,
    profileId: agent ? (agent.profile?.id ?? null) : profileId,
  };
}

/**
 * The agent form's state: its values, the slug and face they lead to, and whether the API would take them. A new
 * agent starts with `defaultProfileId`, the hirer's default access profile in the company.
 */
export function useAgentDraft(
  agent: AgentDetail | undefined,
  reportsTo: string,
  defaultProfileId: string | null = null,
): AgentDraft {
  const [values, setValues] = useState(() => startOf(agent, reportsTo, defaultProfileId));
  const slug = slugify(values.name, 'agent');
  return {
    values,
    set: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    slug,
    face: values.face ?? agentFace(slug),
    valid:
      within(values.name, AGENT_NAME) &&
      within(values.roleTitle, AGENT_ROLE_TITLE) &&
      within(values.model, { min: 1, max: AGENT_MODEL_MAX }) &&
      values.instructions.length <= AGENT_INSTRUCTIONS_MAX,
    reset: () => setValues(startOf(agent, reportsTo, defaultProfileId)),
  };
}

/** The new agent as `POST /agents` takes it: every field, the face as shown, its manager and its access profile. */
export function newAgentOf(draft: AgentDraft): NewAgent {
  const { values } = draft;
  return {
    name: values.name.trim(),
    roleTitle: values.roleTitle.trim(),
    face: draft.face,
    model: values.model.trim(),
    effort: values.effort,
    harness: values.harness,
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
    model: values.model.trim(),
    effort: values.effort,
    harness: values.harness,
    maxConcurrentRuns: values.maxConcurrentRuns,
    instructions: values.instructions,
  };
  const changed = Object.fromEntries(
    Object.entries(next).filter(([key, value]) => agent[key as keyof typeof next] !== value),
  ) as Partial<AgentChanges>;
  const profileId = agent.profile?.id ?? null;
  return values.profileId === profileId ? changed : { ...changed, profileId: values.profileId };
}
