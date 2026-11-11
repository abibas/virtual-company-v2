import type { PrincipalKind } from '../enums.ts';

/** One principal on a company's org chart: a person or an agent, and whom it reports to (null: at the top). */
export interface ChartNode {
  readonly principalId: string;
  readonly kind: PrincipalKind;
  readonly reportsTo: string | null;
}

/**
 * A company's org chart in memory (its `org_positions` with each principal's kind). Its order is the stable order of
 * every list the rules return; a principal listed twice counts by its first entry (`validateChart` reports the rest).
 */
export type Chart = readonly ChartNode[];

/** A change of manager: `principalId` now reports to `reportsTo` (null: at the top). */
export interface ChartMove {
  readonly principalId: string;
  readonly reportsTo: string | null;
}

/** A chart looked up by principal: each one's first entry, in chart order, and its direct reports in chart order. */
export interface ChartIndex {
  readonly nodes: readonly ChartNode[];
  readonly byId: ReadonlyMap<string, ChartNode>;
  readonly reports: ReadonlyMap<string, readonly ChartNode[]>;
}

/** Indexes a chart once, so a rule walks it without searching. Reporting to oneself makes nobody a report. */
export function indexChart(chart: Chart): ChartIndex {
  const byId = new Map<string, ChartNode>();
  for (const node of chart) if (!byId.has(node.principalId)) byId.set(node.principalId, node);
  const reports = new Map<string, ChartNode[]>();
  for (const node of byId.values()) {
    if (node.reportsTo === null || node.reportsTo === node.principalId) continue;
    reports.set(node.reportsTo, [...(reports.get(node.reportsTo) ?? []), node]);
  }
  return { nodes: [...byId.values()], byId, reports };
}

/** A node's manager on the chart; undefined at the top or when the manager is not on the chart. */
export function managerOf(index: ChartIndex, node: ChartNode): ChartNode | undefined {
  return node.reportsTo === null ? undefined : index.byId.get(node.reportsTo);
}

/**
 * The managers above a node, nearest first. The walk ends at the top, at a manager who is not on the chart, or before
 * a manager it has seen already, so a loop in the data ends it too: a node on a loop is the last of its own chain.
 */
export function chainAbove(index: ChartIndex, node: ChartNode): ChartNode[] {
  const chain: ChartNode[] = [];
  const seen = new Set<string>();
  for (
    let up = managerOf(index, node);
    up !== undefined && !seen.has(up.principalId);
    up = managerOf(index, up)
  ) {
    chain.push(up);
    seen.add(up.principalId);
  }
  return chain;
}

/** The node itself when it is a person, else the first person above it; undefined when there is none. */
export function personAtOrAbove(index: ChartIndex, node: ChartNode): ChartNode | undefined {
  return node.kind === 'person' ? node : chainAbove(index, node).find((up) => up.kind === 'person');
}

/** True when the node's chain comes back to it: it reports to itself, or to someone below it. */
export function onLoop(index: ChartIndex, node: ChartNode): boolean {
  return chainAbove(index, node).some((up) => up.principalId === node.principalId);
}

/** A principal's direct reports, in chart order. */
export function reportsOf(index: ChartIndex, principalId: string): readonly ChartNode[] {
  return index.reports.get(principalId) ?? [];
}

/**
 * Everyone below a principal, depth-first (each report followed by everyone below it), reports in chart order. The
 * principal itself is never listed, so a loop through it in the data ends the walk instead of repeating it.
 */
export function subtreeOf(index: ChartIndex, principalId: string): ChartNode[] {
  const found: ChartNode[] = [];
  const seen = new Set([principalId]);
  const stack = [...reportsOf(index, principalId)].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (seen.has(node.principalId)) continue;
    seen.add(node.principalId);
    found.push(node);
    stack.push(...[...reportsOf(index, node.principalId)].reverse());
  }
  return found;
}

/**
 * The chart after `moves`, without `removed` (a principal leaving) when given, in the same order: what the rules check
 * again before the moves are written.
 */
export function applyMoves(chart: Chart, moves: readonly ChartMove[], removed?: string): ChartNode[] {
  const to = new Map(moves.map((move) => [move.principalId, move]));
  return chart
    .filter((node) => node.principalId !== removed)
    .map((node) => {
      const move = to.get(node.principalId);
      return move === undefined ? node : { ...node, reportsTo: move.reportsTo };
    });
}

/**
 * The people who answer for a principal's team: the principal itself when it is a person, then every person above it,
 * nearest first (agents in the chain are skipped). None for a principal not on the chart.
 */
export function peopleAtOrAbove(chart: Chart, principalId: string): string[] {
  const index = indexChart(chart);
  const node = index.byId.get(principalId);
  if (node === undefined) return [];
  return [node, ...chainAbove(index, node)].filter((n) => n.kind === 'person').map((n) => n.principalId);
}
