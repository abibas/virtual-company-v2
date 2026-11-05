import type { TenantDb } from '@mwc/db';
import type { OrgRepo } from '../repo.ts';
import {
  moveRefusal,
  POSITION_NOT_FOUND,
  positionChanges,
  positionRefusal,
  type Refusal,
} from '../rules/placement.ts';
import type { PositionView, UpdatePosition } from '../schemas.ts';
import { auditPosition, type Caller } from './audit.ts';
import { loadOrg, positionView } from './read.ts';

export type PositionResult =
  | { readonly ok: true; readonly position: PositionView }
  | Refusal<403 | 404 | 422>;

/**
 * Moves a principal on the chart, sets its title, or both, in one transaction under the company's lock. The
 * principal must be on the chart: an active member or an agent not archived (404 otherwise, also for another
 * company's). Moving anyone, and titling someone else, is for admins and owners (403); any active member titles
 * themselves. A move the org rules refuse is a 422 with their code. Only what differs is written, with one audit row
 * per field.
 */
export function setPosition(
  repo: OrgRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly principalId: string; readonly body: UpdatePosition },
): Promise<PositionResult> {
  return t.transaction(async (tx) => {
    await repo.lock(tx);
    const org = await loadOrg(repo, tx);
    // Only a principal on the chart: a removed member's position left behind is not one.
    const onChart = org.chart.some((node) => node.principalId === change.principalId);
    const position = onChart ? org.positions.get(change.principalId) : undefined;
    if (position === undefined) return POSITION_NOT_FOUND;
    const { reportsToPrincipalId: reportsTo, title } = change.body;
    const self = change.principalId === caller.principalId;
    const refusal = positionRefusal(caller.role, {
      self,
      moves: reportsTo !== undefined,
      titles: title !== undefined,
    });
    if (refusal) return refusal;
    const set = positionChanges(position, { reportsTo, title });
    const moveRefused =
      set.reportsToPrincipalId === undefined
        ? undefined
        : moveRefusal(org.chart, change.principalId, set.reportsToPrincipalId);
    if (moveRefused) return moveRefused;
    if (Object.keys(set).length === 0) return { ok: true as const, position: positionView(position) };
    const after = await repo.updatePosition(tx, change.principalId, set);
    await auditPosition(repo, tx, caller, {
      principalId: change.principalId,
      action: 'update',
      before: position,
      after,
    });
    return { ok: true as const, position: positionView(after) };
  });
}
