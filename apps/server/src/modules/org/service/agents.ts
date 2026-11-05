import { diffFields, type TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { agentFace } from '@mwc/shared/org';
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
import { agentDetail, loadOrg } from './read.ts';
import { moveForStatus } from './status.ts';

export type AgentResult<S extends RefusalStatus> =
  | { readonly ok: true; readonly agent: AgentDetailView }
  | Refusal<S>;

/**
 * Creates an agent in one transaction under the company's lock: its principal (kind `agent`), the agent and its
 * position under `reportsToPrincipalId` (the caller when left out), with their audit rows. The slug is the one
 * chosen (409 when taken) or derived from the name; the face, left out, comes from the slug. A place the org rules
 * refuse is a 422 with their code, decided before anything is written.
 */
export function createAgent(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  input: CreateAgent,
): Promise<AgentResult<409 | 422>> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const { reportsToPrincipalId, slug: chosen, face, ...fields } = input;
    const slug = chooseSlug(input.name, chosen, await repo.takenSlugs(tx));
    if (typeof slug !== 'string') return slug;
    const principalId = newId();
    const reportsTo = reportsToPrincipalId === undefined ? caller.principalId : reportsToPrincipalId;
    const refusal = placeRefusal((await loadOrg(repo, tx)).chart, { principalId, kind: 'agent', reportsTo });
    if (refusal) return refusal;
    const agent = await repo.insertAgent(tx, { ...fields, principalId, slug, face: face ?? agentFace(slug) });
    const position = await repo.placePosition(tx, { principalId, reportsToPrincipalId: reportsTo });
    await repo.audit(tx, {
      ...auditEntry(caller, 'agent', agent.id, 'create'),
      changes: diffFields(null, auditedAgent(agent)),
    });
    await auditPosition(repo, tx, caller, { principalId, action: 'create', after: position });
    return { ok: true as const, agent: agentDetail(agent, position) };
  });
}

/**
 * Changes an agent in one transaction under the company's lock: only the fields that differ are written, with one
 * audit row each (new instructions as a bump of `instructionsRev`). A slug another agent has is a 409; archiving
 * and restoring move it on the chart (`moveForStatus`), refused with a 422 before anything is written.
 */
export function updateAgent(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly agentId: string; readonly patch: UpdateAgent },
): Promise<AgentResult<404 | 409 | 422>> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const agent = await repo.getAgent(tx, change.agentId);
    if (agent === undefined) return AGENT_NOT_FOUND;
    const set = agentChanges(agent, change.patch);
    if (set.slug !== undefined && (await repo.takenSlugs(tx)).has(set.slug)) return slugTaken(set.slug);
    const moved = await moveForStatus(repo, tx, caller, agent, statusMove(agent.status, set.status));
    if (!moved.ok) return moved;
    if (Object.keys(set).length === 0)
      return { ok: true as const, agent: agentDetail(agent, moved.position) };
    const after = await repo.updateAgent(tx, agent.id, set);
    await repo.audit(tx, {
      ...auditEntry(caller, 'agent', agent.id, 'update'),
      changes: diffFields(auditedAgent(agent), auditedAgent(after)),
    });
    return { ok: true as const, agent: agentDetail(after, moved.position) };
  });
}
