import type { PrincipalKind } from './enums.ts';
import {
  applyMoves,
  type Chart,
  type ChartIndex,
  type ChartMove,
  type ChartNode,
  indexChart,
  managerOf,
  onLoop,
  personAtOrAbove,
  reportsOf,
  subtreeOf,
} from './org-chart/chart.ts';
import {
  type ChartViolation,
  type ChartViolationCode,
  violation,
  violationsOf,
} from './org-chart/violations.ts';

export type { Chart, ChartMove, ChartNode } from './org-chart/chart.ts';
export { applyMoves, peopleAtOrAbove } from './org-chart/chart.ts';
export type { ChartViolation, ChartViolationCode } from './org-chart/violations.ts';

// The org chart's invariants (docs/architecture.md, section 6): no loops, agents never at the top, every agent's
// chain reaches a person, agents never manage people. Pure functions over one company's chart, shared so the server
// (which judges every change) and the web (which shows where a dragged card may go) decide with one implementation;
// both show the refusal and violation codes. The chart model and its walks are in org-chart/chart.ts, the
// per-principal violations in org-chart/violations.ts.

/** Why a move is refused. */
export type MoveRefusalCode =
  | 'unknown_principal'
  | 'self'
  | 'cycle'
  | 'agent_root'
  | 'agent_manages_person'
  | 'chain_without_person';

/** A move's verdict: allowed, or refused with a code and a sentence a UI can show. */
export type MoveCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MoveRefusalCode; readonly message: string };

const refuse = (code: MoveRefusalCode, message: string): MoveCheck => ({ ok: false, code, message });

/** Why `node` may not report to `managerId` (null: the top), or undefined when that place is fine for it. */
function placeRefusal(
  index: ChartIndex,
  node: ChartNode,
  managerId: string | null,
  below: readonly ChartNode[],
): MoveCheck | undefined {
  if (managerId === null) {
    if (node.kind === 'person') return undefined;
    return refuse(
      'agent_root',
      'An agent must report to someone; only people can be at the top of the chart.',
    );
  }
  const manager = index.byId.get(managerId);
  if (manager === undefined)
    return refuse('unknown_principal', "The new manager is not on this company's org chart.");
  if (managerId === node.principalId) return refuse('self', 'Nobody can report to themselves.');
  if (below.some((report) => report.principalId === managerId)) {
    return refuse(
      'cycle',
      'The new manager is below the one being moved, so this move would make a reporting loop.',
    );
  }
  if (node.kind === 'person' && manager.kind === 'agent') {
    return refuse(
      'agent_manages_person',
      'A person cannot report to an agent; people report only to people.',
    );
  }
  return undefined;
}

/**
 * Whether `principalId` may report to `newReportsTo` (null: move to the top). Refused, in this order: either one is
 * not on the chart (`unknown_principal`); itself (`self`); someone below it (`cycle`); a person under an agent
 * (`agent_manages_person`); an agent to the top (`agent_root`); and any agent of the moved subtree, the principal or
 * anyone below it, left without a person above it (`chain_without_person`).
 */
export function validateMove(chart: Chart, principalId: string, newReportsTo: string | null): MoveCheck {
  const index = indexChart(chart);
  const node = index.byId.get(principalId);
  if (node === undefined) {
    return refuse('unknown_principal', "This person or agent is not on this company's org chart.");
  }
  const below = subtreeOf(index, principalId);
  const refusal = placeRefusal(index, node, newReportsTo, below);
  if (refusal !== undefined) return refusal;
  const placed = { ...node, reportsTo: newReportsTo };
  const moved = indexChart(index.nodes.map((other) => (other === node ? placed : other)));
  if ([placed, ...below].some((n) => n.kind === 'agent' && personAtOrAbove(moved, n) === undefined)) {
    return refuse(
      'chain_without_person',
      'Every agent needs a person above it, and this move would leave an agent without one.',
    );
  }
  return { ok: true };
}

/** The invariants `after` breaks that `before` did not (by code and principal), in chart order. */
export function addedViolations(before: Chart, after: Chart): ChartViolation[] {
  const known = new Set(validateChart(before).map((v) => `${v.code} ${v.principalId}`));
  return validateChart(after).filter((v) => !known.has(`${v.code} ${v.principalId}`));
}

/** A move's verdict as the API gives it: allowed, or refused with a move code or the invariant it would break. */
export type MoveVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MoveRefusalCode | ChartViolationCode; readonly message: string };

/**
 * Whether the API takes `principalId` reporting to `newReportsTo` (null: the top): `validateMove`, then no invariant
 * the chart after the move breaks that it did not break before (a chart stored with a flaw, such as an orphan, still
 * takes moves that add none). What `PUT /org/positions` answers, and what the web's drag and drop shows before it
 * asks; moving someone to the manager they have is allowed (it changes nothing).
 */
export function moveVerdict(chart: Chart, principalId: string, newReportsTo: string | null): MoveVerdict {
  const check = validateMove(chart, principalId, newReportsTo);
  if (!check.ok) return check;
  const [added] = addedViolations(chart, applyMoves(chart, [{ principalId, reportsTo: newReportsTo }]));
  return added ? { ok: false, code: added.code, message: added.message } : { ok: true };
}

/**
 * The person who answers for a principal: a person answers for themselves; for an agent, the first person above
 * it. Null when there is none (the principal is not on the chart, or its chain reaches no person): callers then
 * fall back to the company owner (docs/architecture.md, section 11: attention items go to the nearest person up).
 */
export function nearestPersonUp(chart: Chart, principalId: string): string | null {
  const index = indexChart(chart);
  const node = index.byId.get(principalId);
  const person = node === undefined ? undefined : personAtOrAbove(index, node);
  return person?.principalId ?? null;
}

/** A principal's direct reports, in chart order; none for a principal not on the chart. */
export function directReports(chart: Chart, principalId: string): ChartNode[] {
  return [...reportsOf(indexChart(chart), principalId)];
}

/**
 * Everyone below a principal, depth-first: each direct report (in chart order) followed by everyone below it. A
 * loop in the data ends the walk; the principal itself is never listed.
 */
export function descendants(chart: Chart, principalId: string): ChartNode[] {
  return subtreeOf(indexChart(chart), principalId);
}

/** The principal `id` when it is a person on the chart. */
function personOn(index: ChartIndex, id: string | null): ChartNode | undefined {
  const node = id === null ? undefined : index.byId.get(id);
  return node?.kind === 'person' ? node : undefined;
}

/**
 * The moves when a principal leaves the chart (a removed person, an archived agent): its direct reports move to
 * its own manager, in chart order. People go to a person only: the nearest one at or above that manager, else the
 * top. Agents go to that manager when a person is above it, else (the one leaving was at the top, or its manager
 * is not on the chart or below it) to `fallbackPersonId`, the company owner. A fallback that is not a person on the
 * chart, or is the one leaving, is not used; an agent with nowhere to go is then moved to the top, which
 * `validateChart` reports (`agent_root`), so the caller refuses the removal rather than strand it. On a valid chart
 * with a usable fallback, the chart after the moves (`applyMoves(chart, moves, principalId)`) passes
 * `validateChart`.
 */
export function reparentOnRemoval(
  chart: Chart,
  principalId: string,
  fallbackPersonId: string | null,
): ChartMove[] {
  const index = indexChart(chart);
  const removed = index.byId.get(principalId);
  if (removed === undefined) return [];
  const rest = indexChart(index.nodes.filter((node) => node !== removed));
  const below = new Set(subtreeOf(index, principalId).map((node) => node.principalId));
  const up = removed.reportsTo;
  const manager = up === null || below.has(up) ? undefined : rest.byId.get(up);
  const person = manager && personAtOrAbove(rest, manager);
  const agentsTo = person ? manager : personOn(rest, fallbackPersonId);
  return reportsOf(index, principalId).map((report) => ({
    principalId: report.principalId,
    reportsTo: (report.kind === 'person' ? person : agentsTo)?.principalId ?? null,
  }));
}

/**
 * Every invariant over a whole chart: the violations in chart order (a principal's later entries are
 * `duplicate_principal`), none for a valid chart. The final guard of the org API before it writes, and of its tests.
 */
export function validateChart(chart: Chart): ChartViolation[] {
  const index = indexChart(chart);
  const seen = new Set<string>();
  return chart.flatMap((node) => {
    const codes: readonly ChartViolationCode[] = seen.has(node.principalId)
      ? ['duplicate_principal']
      : violationsOf(index, node);
    seen.add(node.principalId);
    return codes.map((code) => violation(code, node.principalId));
  });
}

/** A principal in the org tree, with its direct reports. `orphan` marks a top entry that has a manager in the data. */
export interface OrgTreeNode {
  readonly principalId: string;
  readonly kind: PrincipalKind;
  readonly orphan: boolean;
  readonly children: OrgTreeNode[];
}

/**
 * The chart as a tree (`GET /org/chart`): its top entries in chart order, each with its reports in chart order.
 * Nobody is dropped and nobody shows twice: a principal whose manager is not on the chart, and the first of a loop
 * in the data, are top entries flagged `orphan: true`, with everyone below them.
 */
export function buildTree(chart: Chart): OrgTreeNode[] {
  const index = indexChart(chart);
  const placed = new Set<string>();
  const grow = (node: ChartNode, orphan: boolean): OrgTreeNode => {
    placed.add(node.principalId);
    const children: OrgTreeNode[] = [];
    for (const report of reportsOf(index, node.principalId)) {
      if (!placed.has(report.principalId)) children.push(grow(report, false));
    }
    return { principalId: node.principalId, kind: node.kind, orphan, children };
  };
  const tops: OrgTreeNode[] = [];
  for (const node of index.nodes) {
    if (placed.has(node.principalId)) continue;
    if (node.reportsTo === null) tops.push(grow(node, false));
    else if (managerOf(index, node) === undefined || onLoop(index, node)) tops.push(grow(node, true));
  }
  return tops;
}
