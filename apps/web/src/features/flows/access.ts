import type { MembershipRole } from '@mwc/shared/enums';
import { peopleAtOrAbove } from '@mwc/shared/org-chart';
import { roleAtLeast } from '@mwc/shared/roles';
import type { FlowSummary } from '../../api/flows.ts';
import type { ChartNode, OrgChart } from '../../api/types.ts';
import { personNode } from '../../components/org/chart.ts';
import { type FlowLinks, leadAddress } from './links.ts';

/** Who is looking: their role in the company, their user id, and the chart that places them. */
export interface Viewer {
  readonly role: MembershipRole;
  readonly userId: string;
  readonly chart: OrgChart | undefined;
}

/** The signed-in person's principal on the chart, by their user id. */
export const myPrincipal = (viewer: Viewer): string | undefined =>
  viewer.chart ? personNode(viewer.chart.nodes, viewer.userId)?.principalId : undefined;

/**
 * True when the viewer leads the team of `leadId` as the API judges it (S5.3a, docs/processes.md): a company admin or
 * owner, or a member who is the Lead or above it on the chart (`peopleAtOrAbove`). They change the flow, put a task
 * into a step, route, retry and cancel. The server stays the judge.
 */
export function leadsTeam(viewer: Viewer, leadId: string): boolean {
  if (roleAtLeast(viewer.role, 'admin')) return true;
  if (!roleAtLeast(viewer.role, 'member') || !viewer.chart) return false;
  const me = myPrincipal(viewer);
  return me !== undefined && peopleAtOrAbove(viewer.chart.nodes, leadId).includes(me);
}

/** The chart's managers: everyone with someone reporting to them, in chart order. */
export function managersOf(chart: OrgChart): ChartNode[] {
  const managers = new Set(chart.nodes.map((node) => node.reportsTo));
  return chart.nodes.filter((node) => managers.has(node.principalId));
}

/** The managers without a flow whom the viewer may make one for (the "Create a flow" choices). */
export function flowCandidates(viewer: Viewer, flows: readonly FlowSummary[]): ChartNode[] {
  if (!viewer.chart) return [];
  const led = new Set(flows.map((flow) => flow.lead.principalId));
  return managersOf(viewer.chart).filter(
    (node) => !led.has(node.principalId) && leadsTeam(viewer, node.principalId),
  );
}

/** A chart node's address under `/flows/`. */
export const nodeAddress = (node: ChartNode): string =>
  leadAddress({ principalId: node.principalId, slug: node.kind === 'agent' ? node.agent.slug : null });

/** A card menu's flow item on the chart: open a manager's flow, or make one. */
export interface ChartFlowItem {
  readonly label: string;
  readonly href: string;
  readonly create: boolean;
}

/**
 * The flow item of each card on the org chart: "Open its flow" for a Lead with one, "Create its flow" for a manager
 * without one whom the viewer may lead; nothing for anyone else.
 */
export function chartFlowItems(
  viewer: Viewer,
  flows: readonly FlowSummary[] | undefined,
  links: FlowLinks,
): (principalId: string) => ChartFlowItem | undefined {
  const chart = viewer.chart;
  if (!chart || !flows) return () => undefined;
  const led = new Set(flows.map((flow) => flow.lead.principalId));
  const managers = new Map(managersOf(chart).map((node) => [node.principalId, node]));
  return (principalId) => {
    const node = chart.nodes.find((n) => n.principalId === principalId);
    if (!node) return undefined;
    if (led.has(principalId))
      return { label: 'Open its flow', href: links.team(nodeAddress(node)), create: false };
    if (!managers.has(principalId) || !leadsTeam(viewer, principalId)) return undefined;
    return { label: 'Create its flow', href: links.team(nodeAddress(node), 'flow'), create: true };
  };
}
