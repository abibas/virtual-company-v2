import type { Agent } from '@mwc/db';
import type { AgentStatus, MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { slugify, withSuffix } from '@mwc/shared/slugs';
import { type Refusal, refuse } from './placement.ts';

// The agents' own rules: their slugs, what a change writes, how a status change moves them on the chart, what the
// audit log keeps of them, and who gives them an access profile. Pure.

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

/** The agent fields the audit log follows: its instructions by their revision, never their text; its profile's id. */
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
    profileId: agent.profileId,
  };
}

// Who may put an access profile on an agent, or choose it as their default for the agents they hire (S3.4,
// docs/subscriptions.md): only its owner, signed in to the web app, in a company where they are an admin or an owner.
// Taking a profile off an agent is any admin's or owner's (the agent routes are theirs). Pure.

export const PROFILE_NOT_FOUND = refuse(422, 'profile_not_found', 'No such access profile');

export const PROFILE_NOT_YOURS = refuse(
  403,
  'profile_not_yours',
  'Only its owner gives an access profile; you may take it off',
);

export const PROFILE_SESSION_REQUIRED = refuse(
  403,
  'session_required',
  'Giving an access profile needs you signed in to the web app; an API key cannot',
);

export const PROFILE_ADMIN_REQUIRED = refuse(
  403,
  'forbidden',
  'Only admins and owners give their access profiles in a company',
);

/** Who gives a profile: the member acting, with how they signed in. */
export interface Giver {
  readonly userId: string;
  readonly role: MembershipRole;
  /** Signed in to the web app (a session), not an API key. */
  readonly session: boolean;
}

/**
 * Why `giver` may not give the profile whose owner is `ownerUserId` (undefined: there is no such profile), or
 * undefined when they may: an API key (403 `session_required`), a member or viewer (403 `forbidden`), no such profile
 * (422 `profile_not_found`), someone else's (403 `profile_not_yours`).
 */
export function giveRefusal(giver: Giver, ownerUserId: string | undefined): Refusal<403 | 422> | undefined {
  if (!giver.session) return PROFILE_SESSION_REQUIRED;
  if (!roleAtLeast(giver.role, 'admin')) return PROFILE_ADMIN_REQUIRED;
  if (ownerUserId === undefined) return PROFILE_NOT_FOUND;
  if (ownerUserId !== giver.userId) return PROFILE_NOT_YOURS;
  return undefined;
}

/** What a requested profile does to the one an agent (or a default) has: give one, take it off, or nothing. */
export type ProfileStep = 'give' | 'remove' | 'none';

export function profileStep(current: string | null, requested: string | null | undefined): ProfileStep {
  if (requested === undefined || requested === current) return 'none';
  return requested === null ? 'remove' : 'give';
}
