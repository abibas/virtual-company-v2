import type { Agent, OrgPosition, TenantDb } from '@mwc/db';
import type { OrgRepo } from '../repo.ts';
import type { StatusMove } from '../rules/agents.ts';
import { archiveMoves, earliestOwner, placeRefusal, type Refusal } from '../rules/placement.ts';
import { reparentOnRemoval } from '../rules.ts';
import { auditPosition, type Caller } from './audit.ts';
import { loadOrg } from './read.ts';

type Moved = { readonly ok: true; readonly position: OrgPosition | undefined } | Refusal<422>;

/**
 * Archiving takes the agent off the chart: its direct reports move up (`reparentOnRemoval`, falling back on the
 * company's earliest active owner) and its own position is removed, each with its audit rows. A chart that would
 * break an invariant it did not break before is a 422, decided before anything is written.
 */
async function archive(repo: OrgRepo, t: TenantDb, caller: Caller, agent: Agent): Promise<Moved> {
  const org = await loadOrg(repo, t);
  const moves = reparentOnRemoval(org.chart, agent.principalId, earliestOwner(org.memberList));
  const plan = archiveMoves(org.chart, agent.principalId, moves);
  if (!plan.ok) return plan;
  for (const move of plan.moves) {
    const after = await repo.updatePosition(t, move.principalId, { reportsToPrincipalId: move.reportsTo });
    const before = org.positions.get(move.principalId);
    await auditPosition(repo, t, caller, { principalId: move.principalId, action: 'update', before, after });
  }
  const removed = await repo.removePosition(t, agent.principalId);
  if (removed)
    await auditPosition(repo, t, caller, {
      principalId: agent.principalId,
      action: 'delete',
      before: removed,
    });
  return { ok: true, position: undefined };
}

/** Back from the archive, the agent reports to the caller (422 when the caller is not on the chart). */
async function restore(repo: OrgRepo, t: TenantDb, caller: Caller, agent: Agent): Promise<Moved> {
  const org = await loadOrg(repo, t);
  const node = { principalId: agent.principalId, kind: 'agent', reportsTo: caller.principalId } as const;
  const refusal = placeRefusal(org.chart, node);
  if (refusal) return refusal;
  const position = await repo.placePosition(t, {
    principalId: agent.principalId,
    reportsToPrincipalId: caller.principalId,
  });
  await auditPosition(repo, t, caller, { principalId: agent.principalId, action: 'create', after: position });
  return { ok: true, position };
}

/**
 * What a status change does on the chart, in the caller's transaction under the company's lock: archive, restore, or
 * nothing (the agent keeps its place). Returns the agent's position afterwards (none once archived).
 */
export async function moveForStatus(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  agent: Agent,
  move: StatusMove,
): Promise<Moved> {
  if (move === 'archive') return archive(repo, t, caller, agent);
  if (move === 'restore') return restore(repo, t, caller, agent);
  return { ok: true, position: await repo.getPosition(t, agent.principalId) };
}
