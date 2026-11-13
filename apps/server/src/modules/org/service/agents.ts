import { type Agent, diffFields, type OrgPosition, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { agentFace } from '@mwc/shared/org';
import type { ServerDeps } from '../../../platform/env.ts';
import { placementsOf } from '../../machines/service/placement.ts';
import { noticeAgentStatus } from '../../notifications/service.ts';
import type { OrgRepo } from '../repo.ts';
import {
  AGENT_NOT_FOUND,
  agentChanges,
  auditedAgent,
  chooseSlug,
  slugTaken,
  statusMove,
} from '../rules/agents.ts';
import { placeRefusal, type Refusal, type RefusalStatus } from '../rules/placement.ts';
import type { AgentDetailView, CreateAgent, UpdateAgent } from '../schemas.ts';
import { auditEntry, auditPosition, type Caller } from './audit.ts';
import { agentIconHash } from './icons.ts';
import { moveForStatus } from './lifecycle.ts';
import { newAgentProfile, profileChange, profileExtras, profileRefs } from './profiles.ts';
import { agentDetail, loadOrg } from './read.ts';

export type AgentResult<S extends RefusalStatus> =
  | { readonly ok: true; readonly agent: AgentDetailView }
  | Refusal<S>;

/** An agent as a change leaves it, with its place (none once archived); the service shows it with its profile. */
export type AgentRows<S extends RefusalStatus> =
  | { readonly ok: true; readonly agent: Agent; readonly position: OrgPosition | undefined }
  | Refusal<S>;

/**
 * An agent a change left, as the API shows it: with its access profile, what that runs, where it runs and its icon,
 * read after the change's transaction.
 */
export async function shownAgent<S extends RefusalStatus>(
  deps: Pick<ServerDeps, 'db'>,
  repo: OrgRepo,
  t: TenantDb,
  result: AgentRows<S>,
): Promise<AgentResult<S>> {
  if (!result.ok) return result;
  const { agent, position } = result;
  const profile = profileExtras(await profileRefs(deps, repo, t, [agent.profileId]), agent);
  const placement = (await placementsOf(t)).get(agent.id) ?? null;
  const iconHash = await agentIconHash(t, agent.id);
  const shown = agentDetail(agent, position, { ...profile, placement, iconHash });
  return { ok: true, agent: shown };
}

/**
 * Creates an agent in one transaction under the company's lock: its principal (kind `agent`), the agent and its
 * position under `reportsToPrincipalId` (the caller when left out), with their audit rows. The slug is the one
 * chosen (409 when taken) or derived from the name; the face, left out, comes from the slug; the access profile is
 * the one given (only the caller's own: 403; 422 for none or one without the harness's part), else the
 * caller's default here of the harness's provider (`newAgentProfile`). A refusal is decided before anything is
 * written.
 */
export function createAgent(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  input: CreateAgent,
): Promise<AgentRows<403 | 409 | 422>> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const { reportsToPrincipalId, slug: chosen, face, profileId: requested, ...fields } = input;
    const slug = chooseSlug(input.name, chosen, await repo.takenSlugs(tx));
    if (typeof slug !== 'string') return slug;
    const principalId = newId();
    const reportsTo = reportsToPrincipalId === undefined ? caller.principalId : reportsToPrincipalId;
    const refusal = placeRefusal((await loadOrg(repo, tx)).chart, { principalId, kind: 'agent', reportsTo });
    if (refusal) return refusal;
    const profile = await newAgentProfile(repo, tx, caller, { requested, harness: input.harness });
    if (!profile.ok) return profile;
    const values = {
      ...fields,
      principalId,
      slug,
      face: face ?? agentFace(slug),
      profileId: profile.profileId,
    };
    const agent = await repo.insertAgent(tx, values);
    const position = await repo.placePosition(tx, { principalId, reportsToPrincipalId: reportsTo });
    await repo.audit(tx, {
      ...auditEntry(caller, 'agent', agent.id, 'create'),
      changes: diffFields(null, auditedAgent(agent)),
    });
    await auditPosition(repo, tx, caller, { principalId, action: 'create', after: position });
    return { ok: true as const, agent, position };
  });
}

/** Whom a principal reports to on the chart now (null: at the top, or off it). */
const managerOf = async (repo: OrgRepo, t: TenantDb, principalId: string) =>
  (await repo.getPosition(t, principalId))?.reportsToPrincipalId ?? null;

/**
 * Changes an agent in one transaction under the company's lock: only the fields that differ are written, with one
 * audit row each (new instructions as a bump of `instructionsRev`). A slug another agent has is a 409; archiving
 * and restoring move it on the chart (`moveForStatus`), refused with a 422; giving it an access profile is only for
 * the profile's owner (403; 422 for none or one without its harness's part), while any admin or owner takes it off, and
 * a harness change its profile has no part for is refused (`profileChange`). A refusal is
 * decided before anything is written. Pausing, resuming and archiving notify the manager it reported to (S2.9).
 */
export function updateAgent(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly agentId: string; readonly patch: UpdateAgent },
): Promise<AgentRows<403 | 404 | 409 | 422>> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const agent = await repo.getAgent(tx, change.agentId);
    if (agent === undefined) return AGENT_NOT_FOUND;
    const { profileId: requested, harness } = change.patch;
    const profile = await profileChange(repo, tx, caller, { agent, requested, harness });
    if (!profile.ok) return profile;
    const set = { ...agentChanges(agent, change.patch), ...profile.set };
    if (set.slug !== undefined && (await repo.takenSlugs(tx)).has(set.slug)) return slugTaken(set.slug);
    const manager = set.status === undefined ? null : await managerOf(repo, tx, agent.principalId);
    const moved = await moveForStatus(repo, tx, caller, agent, statusMove(agent.status, set.status));
    if (!moved.ok) return moved;
    if (Object.keys(set).length === 0) return { ok: true as const, agent, position: moved.position };
    const after = await repo.updateAgent(tx, agent.id, set);
    await repo.audit(tx, {
      ...auditEntry(caller, 'agent', agent.id, 'update'),
      changes: diffFields(auditedAgent(agent), auditedAgent(after)),
    });
    if (set.status !== undefined) {
      const change = { principalId: agent.principalId, from: agent.status, to: set.status, manager };
      await noticeAgentStatus(tx, caller.principalId, change);
    }
    return { ok: true as const, agent: after, position: moved.position };
  });
}
