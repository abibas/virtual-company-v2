import type { Agent, Membership, OrgPosition } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { validateChart, validateMove } from '../rules.ts';
import { applyMoves, type Chart, type ChartMove, type ChartNode } from './chart.ts';

// The org API's decisions over a company's stored chart: who is on it, whether a placement or a removal keeps it
// valid, and who may change a position. Pure; the service reads the rows and writes what these allow.

export type RefusalStatus = 403 | 404 | 409 | 422;

/** A refusal the routes answer in the common error shape, typed by its status so a route documents each one. */
export interface Refusal<S extends RefusalStatus = RefusalStatus> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

export const refuse = <S extends RefusalStatus>(status: S, code: string, message: string): Refusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

export const POSITION_NOT_FOUND = refuse(
  404,
  'position_not_found',
  "No such person or agent on this company's org chart",
);

/** A company's chart as stored: the nodes, and the rows behind them by principal. */
export interface OrgState {
  readonly chart: ChartNode[];
  readonly positions: ReadonlyMap<string, OrgPosition>;
  /** The active memberships, by principal. */
  readonly members: ReadonlyMap<string, Membership>;
  /** The agents not archived, by principal. */
  readonly agents: ReadonlyMap<string, Agent>;
  /** The active memberships in the order people joined. */
  readonly memberList: readonly Membership[];
}

/**
 * The chart from the stored rows: every position whose principal is an active member (a person) or an agent not
 * archived, in the positions' order. A position left by anyone else (a removed member) is not on it, so whoever
 * reports there shows as an orphan.
 */
export function orgState(
  positions: readonly OrgPosition[],
  memberList: readonly Membership[],
  liveAgents: readonly Agent[],
): OrgState {
  const members = new Map(memberList.map((member) => [member.principalId, member]));
  const agents = new Map(liveAgents.map((agent) => [agent.principalId, agent]));
  const chart: ChartNode[] = [];
  for (const position of positions) {
    const kind = members.has(position.principalId)
      ? 'person'
      : agents.has(position.principalId)
        ? 'agent'
        : undefined;
    if (kind !== undefined) {
      chart.push({ principalId: position.principalId, kind, reportsTo: position.reportsToPrincipalId });
    }
  }
  return {
    chart,
    positions: new Map(positions.map((position) => [position.principalId, position])),
    members,
    agents,
    memberList,
  };
}

/** The company's earliest active owner (by when they joined, then id): who takes agents nobody else can. */
export function earliestOwner(memberList: readonly Membership[]): string | null {
  const owners = memberList
    .filter((member) => member.role === 'owner')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return owners[0]?.principalId ?? null;
}

/**
 * The first invariant `after` breaks that `before` did not, as a 422, or undefined. A chart stored with a flaw
 * already (an orphan left by a removed member) still takes changes that add none.
 */
export function chartRefusal(before: Chart, after: Chart): Refusal<422> | undefined {
  const known = new Set(validateChart(before).map((v) => `${v.code} ${v.principalId}`));
  const added = validateChart(after).find((v) => !known.has(`${v.code} ${v.principalId}`));
  return added && refuse(422, added.code, added.message);
}

/** Why `principalId` may not move under `reportsTo` (null: the top), as a 422 with the rules' code, or undefined. */
export function moveRefusal(
  chart: Chart,
  principalId: string,
  reportsTo: string | null,
): Refusal<422> | undefined {
  const check = validateMove(chart, principalId, reportsTo);
  if (!check.ok) return refuse(422, check.code, check.message);
  return chartRefusal(chart, applyMoves(chart, [{ principalId, reportsTo }]));
}

/** Why a principal not on the chart yet (a new or returning agent) may not be placed under `reportsTo`. */
export function placeRefusal(chart: Chart, node: ChartNode): Refusal<422> | undefined {
  const placed = [...chart, node];
  const check = validateMove(placed, node.principalId, node.reportsTo);
  if (!check.ok) return refuse(422, check.code, check.message);
  return chartRefusal(chart, placed);
}

/**
 * The moves when an agent is archived (`reparentOnRemoval` with the earliest active owner to fall back on), or the
 * 422 when the chart after them breaks an invariant it did not break before.
 */
export function archiveMoves(
  chart: Chart,
  principalId: string,
  moves: readonly ChartMove[],
): { readonly ok: true; readonly moves: readonly ChartMove[] } | Refusal<422> {
  return chartRefusal(chart, applyMoves(chart, moves, principalId)) ?? { ok: true, moves };
}

/** A title as stored: trimmed by the schema, an empty one cleared. */
export function storedTitle(title: string | null): string | null {
  return title === '' ? null : title;
}

/**
 * Who may change a position: moving anyone is for admins and owners, and so is titling someone else; any active
 * member may set their own title.
 */
export function positionRefusal(
  role: MembershipRole,
  change: { readonly self: boolean; readonly moves: boolean; readonly titles: boolean },
): Refusal<403> | undefined {
  if (roleAtLeast(role, 'admin')) return undefined;
  if (change.moves) return refuse(403, 'forbidden', 'Only an owner or an admin may move people and agents');
  if (change.titles && !change.self) {
    return refuse(403, 'forbidden', "Only an owner or an admin may set someone else's title");
  }
  return undefined;
}

/** The fields of a position change that differ from the stored position. */
export function positionChanges(
  position: Pick<OrgPosition, 'reportsToPrincipalId' | 'title'>,
  change: { readonly reportsTo?: string | null | undefined; readonly title?: string | null | undefined },
): { reportsToPrincipalId?: string | null; title?: string | null } {
  const title = change.title === undefined ? undefined : storedTitle(change.title);
  return {
    ...(change.reportsTo === undefined || change.reportsTo === position.reportsToPrincipalId
      ? {}
      : { reportsToPrincipalId: change.reportsTo }),
    ...(title === undefined || title === position.title ? {} : { title }),
  };
}
