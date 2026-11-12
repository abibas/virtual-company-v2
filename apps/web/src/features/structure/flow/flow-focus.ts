import type { FlowStepKind } from '@mwc/shared/enums';
import type { Flow, FlowSummary } from '../../../api/flows.ts';
import { CARD, type ChartLayout } from '../../../components/org/layout.ts';
import { leadAddress } from '../../flows/links.ts';

/** One thing a member does in the flow: its Lead, or its steps of one kind ("Code review · QA"). */
export interface FlowRole {
  readonly kind: FlowStepKind | 'lead';
  readonly label: string;
}

/** A flow highlighted on the org chart: everyone in it by principal id, with their roles (the Lead first). */
export interface FlowFocus {
  readonly flowId: string;
  readonly members: ReadonlyMap<string, readonly FlowRole[]>;
}

/** The flow whose Lead is at `address` (an agent Lead's slug or a Lead's principal id), if any. */
export function flowAt(
  flows: readonly FlowSummary[] | undefined,
  address: string | null,
): FlowSummary | undefined {
  if (!address) return undefined;
  return flows?.find((flow) => leadAddress(flow.lead) === address || flow.lead.principalId === address);
}

/** Who is in `flow`: its Lead, and each step's assignee with its steps grouped by kind, in the flow's order. */
export function flowFocus(flow: Pick<Flow, 'id' | 'lead' | 'steps'>): FlowFocus {
  const byMember = new Map<string, Map<FlowStepKind, string[]>>();
  for (const step of flow.steps) {
    const kinds = byMember.get(step.assignee.principalId) ?? new Map<FlowStepKind, string[]>();
    kinds.set(step.kind, [...(kinds.get(step.kind) ?? []), step.name]);
    byMember.set(step.assignee.principalId, kinds);
  }
  const members = new Map<string, FlowRole[]>([[flow.lead.principalId, [{ kind: 'lead', label: 'Lead' }]]]);
  for (const [principalId, kinds] of byMember) {
    const roles = members.get(principalId) ?? [];
    for (const [kind, names] of kinds) roles.push({ kind, label: names.join(' · ') });
    members.set(principalId, roles);
  }
  return { flowId: flow.id, members };
}

/** An edge's key: its manager and its report. */
export const edgeKey = (edge: { readonly from: string; readonly to: string }): string =>
  `${edge.from}>${edge.to}`;

/**
 * The lines that join the highlighted members on the chart, as edge keys: the line into a card is one when its
 * subtree holds some of them and the rest of the chart holds others (the smallest tree that links them all).
 */
export function linkingEdges(layout: ChartLayout, focus: FlowFocus): ReadonlySet<string> {
  const reports = new Map<string, string[]>();
  for (const edge of layout.edges) reports.set(edge.from, [...(reports.get(edge.from) ?? []), edge.to]);
  const counts = new Map<string, number>();
  const countOf = (id: string): number => {
    const known = counts.get(id);
    if (known !== undefined) return known;
    const own = focus.members.has(id) ? 1 : 0;
    const n = (reports.get(id) ?? []).reduce((sum, report) => sum + countOf(report), own);
    counts.set(id, n);
    return n;
  };
  const total = layout.cards.filter((card) => focus.members.has(card.id)).length;
  const keys = new Set<string>();
  for (const edge of layout.edges) {
    const below = countOf(edge.to);
    if (below > 0 && below < total) keys.add(edgeKey(edge));
  }
  return keys;
}

/** A box on the chart, in chart pixels. */
export interface ChartBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The room above a card for its role chips. */
const CHIPS = 12;

/** The box around the highlighted members' cards (with their chips), or undefined when none is on the chart. */
export function focusBox(layout: ChartLayout, focus: FlowFocus): ChartBox | undefined {
  const cards = layout.cards.filter((card) => focus.members.has(card.id));
  if (cards.length === 0) return undefined;
  const x = Math.min(...cards.map((card) => card.x));
  const y = Math.min(...cards.map((card) => card.y)) - CHIPS;
  const right = Math.max(...cards.map((card) => card.x + CARD.width));
  const bottom = Math.max(...cards.map((card) => card.y + CARD.height));
  return { x, y, width: right - x, height: bottom - y };
}
