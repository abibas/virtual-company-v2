import type { Agent, OrgPosition, TenantDb } from '@mwc/db';
import type { Logger } from 'pino';
import type { ServerDeps } from '../../../platform/env.ts';
import { type OrgRepo, orgRepo } from '../repo.ts';
import type { StatusMove } from '../rules/agents.ts';
import type { ChartMove } from '../rules/chart.ts';
import { joiningManager, leavingPlan } from '../rules/lifecycle.ts';
import {
  archiveMoves,
  earliestOwner,
  type OrgState,
  placeRefusal,
  type Refusal,
} from '../rules/placement.ts';
import { reparentOnRemoval } from '../rules.ts';
import { type AuditBy, auditPosition, auditPositionBy, byCaller, type Caller } from './audit.ts';
import { clearProfilesOf } from './profiles.ts';
import { loadOrg } from './read.ts';

// Principals joining and leaving the chart: an agent archived or back from the archive (`moveForStatus`, S2.3), and a
// person whose membership starts or ends (`memberChart`, S2.4). Each runs in the caller's transaction, under the
// company row's lock the caller holds.

/**
 * Takes a principal off the chart once its direct reports have moved: each move written with its `update` audit row,
 * then its own position removed with its `delete` row (an agent archived, a person whose membership ended).
 */
async function takeOffChart(
  repo: OrgRepo,
  t: TenantDb,
  by: AuditBy,
  change: { readonly org: OrgState; readonly principalId: string; readonly moves: readonly ChartMove[] },
): Promise<void> {
  for (const move of change.moves) {
    const after = await repo.updatePosition(t, move.principalId, { reportsToPrincipalId: move.reportsTo });
    const before = change.org.positions.get(move.principalId);
    await auditPositionBy(repo, t, by, { principalId: move.principalId, action: 'update', before, after });
  }
  const removed = await repo.removePosition(t, change.principalId);
  if (removed) {
    await auditPositionBy(repo, t, by, {
      principalId: change.principalId,
      action: 'delete',
      before: removed,
    });
  }
}

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
  await takeOffChart(repo, t, byCaller(caller), { org, principalId: agent.principalId, moves: plan.moves });
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
 * What an agent's status change does on the chart, in the caller's transaction under the company's lock: archive,
 * restore, or nothing (the agent keeps its place). Returns the agent's position afterwards (none once archived).
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

/**
 * A person whose membership became active gets a position under whoever invited them, else under the company's
 * earliest active owner, else at the top (`joiningManager`), with its `create` audit row. A person with a position
 * keeps it as it is, so placing twice changes nothing.
 */
async function placeMember(
  repo: OrgRepo,
  t: TenantDb,
  member: { readonly principalId: string; readonly invitationId: string | null },
  by: AuditBy,
): Promise<void> {
  if ((await repo.getPosition(t, member.principalId)) !== undefined) return;
  const org = await loadOrg(repo, t);
  const inviter = member.invitationId === null ? null : await repo.inviterOf(t, member.invitationId);
  const reportsToPrincipalId = joiningManager(org, member.principalId, inviter);
  const position = await repo.placePosition(t, { principalId: member.principalId, reportsToPrincipalId });
  await auditPositionBy(repo, t, by, { principalId: member.principalId, action: 'create', after: position });
}

/**
 * A person whose membership ended leaves the chart: their direct reports move up (`leavingPlan`) and their position
 * goes, each with its audit rows, and the company's agents lose the person's access profiles (`clearProfilesOf`,
 * S3.4). Their access has ended already, so a chart that breaks an invariant afterwards that it did not break before
 * (an agent left at the top when no other owner is on the chart) is written all the same and logged at warn level.
 */
async function unplaceMember(repo: OrgRepo, logger: Logger, t: TenantDb, principalId: string, by: AuditBy) {
  const org = await loadOrg(repo, t);
  const plan = leavingPlan(org, principalId);
  await takeOffChart(repo, t, by, { org, principalId, moves: plan.moves });
  await clearProfilesOf(repo, t, principalId, by);
  if (plan.violations.length > 0) {
    const violations = plan.violations.map(({ code, principalId: on }) => ({ code, principalId: on }));
    logger.warn(
      { companyId: t.companyId, principalId, violations },
      'a person left the org chart with flaws',
    );
  }
}

/**
 * The org chart's side of a membership's start and end, the identity module's `MemberChart` port: `placeMember` and
 * `unplaceMember`, which every path calls in the membership's own transaction under the company row's lock (the
 * members module's removal, and the identity store for webhook events, the reconciles and Sync now). `createApp`
 * and `moduleJobs` pass it to both modules, so neither imports this one.
 */
export function memberChart(deps: Pick<ServerDeps, 'logger'>) {
  const repo = orgRepo();
  return {
    placeMember: (t: TenantDb, member: { principalId: string; invitationId: string | null }, by: AuditBy) =>
      placeMember(repo, t, member, by),
    unplaceMember: (t: TenantDb, principalId: string, by: AuditBy) =>
      unplaceMember(repo, deps.logger, t, principalId, by),
  };
}
