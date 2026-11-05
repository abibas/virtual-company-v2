import type { Agent } from '@mwc/db';
import type { AgentStatus } from '@mwc/shared/enums';
import { slugify, withSuffix } from '@mwc/shared/slugs';
import { type Refusal, refuse } from './placement.ts';

// The agents' own rules: their slugs, what a change writes, how a status change moves them on the chart, and what
// the audit log keeps of them. Pure.

/** The slug of a name with no letter or digit in it (`!!!`, `日本`). */
export const FALLBACK_AGENT_SLUG = 'agent';

export const AGENT_NOT_FOUND = refuse(404, 'agent_not_found', 'No such agent in this company');

export const slugTaken = (slug: string): Refusal<409> =>
  refuse(409, 'agent_slug_taken', `The slug ${slug} is taken by another agent in this company`);

/**
 * A new agent's slug: the one the caller chose (409 when another agent of the company has it, archived ones too), or
 * the first free one of the name's slug, then `-2`, `-3`, ...
 */
export function chooseSlug(
  name: string,
  chosen: string | undefined,
  taken: ReadonlySet<string>,
): string | Refusal<409> {
  if (chosen !== undefined) return taken.has(chosen) ? slugTaken(chosen) : chosen;
  const base = slugify(name, FALLBACK_AGENT_SLUG);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = withSuffix(base, String(n));
  return slug;
}

/** What a change of status does on the chart: off it (archive), back on it (restore), or nothing. */
export type StatusMove = 'archive' | 'restore' | 'none';

export function statusMove(from: AgentStatus, to: AgentStatus | undefined): StatusMove {
  if (to === undefined || to === from) return 'none';
  if (to === 'archived') return 'archive';
  return from === 'archived' ? 'restore' : 'none';
}

/** An agent's editable fields, as a change gives them. */
export interface AgentPatch {
  readonly name?: string | undefined;
  readonly slug?: string | undefined;
  readonly roleTitle?: string | undefined;
  readonly model?: string | undefined;
  readonly effort?: Agent['effort'] | undefined;
  readonly harness?: Agent['harness'] | undefined;
  readonly instructions?: string | undefined;
  readonly maxConcurrentRuns?: number | undefined;
  readonly face?: number | undefined;
  readonly status?: AgentStatus | undefined;
}

const EDITABLE = [
  'name',
  'slug',
  'roleTitle',
  'model',
  'effort',
  'harness',
  'instructions',
  'maxConcurrentRuns',
  'face',
  'status',
] as const;

type AgentSet = Partial<Pick<Agent, (typeof EDITABLE)[number] | 'instructionsRev'>>;

/**
 * The fields of a change that differ from the agent: an unchanged field writes nothing. New instructions also bump
 * `instructionsRev`, so a run can tell which version it got.
 */
export function agentChanges(agent: Agent, patch: AgentPatch): AgentSet {
  const set: Record<string, unknown> = {};
  for (const field of EDITABLE) {
    const value = patch[field];
    if (value !== undefined && value !== agent[field]) set[field] = value;
  }
  if (set.instructions !== undefined) set.instructionsRev = agent.instructionsRev + 1;
  return set as AgentSet;
}

/** The agent fields the audit log follows: its instructions by their revision, never their text. */
export function auditedAgent(agent: Agent) {
  const { principalId, name, slug, roleTitle, status, harness, model, effort } = agent;
  return {
    principalId,
    name,
    slug,
    roleTitle,
    status,
    harness,
    model,
    effort,
    instructionsRev: agent.instructionsRev,
    maxConcurrentRuns: agent.maxConcurrentRuns,
    face: agent.face,
  };
}
