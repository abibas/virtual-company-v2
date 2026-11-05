import type { PrincipalKind } from '@mwc/shared/enums';
import type { ChartNode, OrgTreeNode } from '../../api/types.ts';
import type { SelectOption } from '../forms/Input.tsx';

/** The name a place on the chart shows: a person's display name (else their email), an agent's name. */
export function nodeName(node: ChartNode): string {
  return node.kind === 'person' ? node.person.displayName || node.person.email : node.agent.name;
}

/** The line under the name: the title on the chart; else a person's email (under their name), an agent's role. */
export function nodeSubtitle(node: ChartNode): string | undefined {
  if (node.title) return node.title;
  if (node.kind === 'agent') return node.agent.roleTitle;
  return node.person.displayName ? node.person.email : undefined;
}

/** The nodes by principal id. */
export function nodesById(nodes: readonly ChartNode[]): ReadonlyMap<string, ChartNode> {
  return new Map(nodes.map((node) => [node.principalId, node]));
}

/** The signed-in person's place on the chart, by their user id. */
export function personNode(nodes: readonly ChartNode[], userId: string): ChartNode | undefined {
  return nodes.find((node) => node.kind === 'person' && node.person.userId === userId);
}

function find(tree: readonly OrgTreeNode[], principalId: string): OrgTreeNode | undefined {
  for (const node of tree) {
    if (node.principalId === principalId) return node;
    const below = find(node.children, principalId);
    if (below) return below;
  }
  return undefined;
}

/** Everyone below `principalId` in the tree (not the principal itself). */
export function below(tree: readonly OrgTreeNode[], principalId: string): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (node: OrgTreeNode) => {
    for (const child of node.children) {
      ids.add(child.principalId);
      walk(child);
    }
  };
  const start = find(tree, principalId);
  if (start) walk(start);
  return ids;
}

/** Who is being placed: an agent or person on the chart, or a new agent (no principal yet). */
export interface Subject {
  readonly principalId?: string;
  readonly kind: PrincipalKind;
}

/** The value of the "top of the chart" choice (no manager), which only people may take. */
export const TOP = '';

/**
 * The managers `subject` may report to, as select options: people, then agents, in chart order, each with its title.
 * The org rules' refusals are shown, not hidden: someone below the subject (a loop) and, for a person, every agent
 * (people report to people) are disabled. A person may also go to the top of the chart. The server stays the judge.
 */
export function managerOptions(
  nodes: readonly ChartNode[],
  tree: readonly OrgTreeNode[],
  subject: Subject,
  meUserId?: string,
): SelectOption[] {
  const team = subject.principalId ? below(tree, subject.principalId) : new Set<string>();
  const agentsGroup = subject.kind === 'person' ? 'Agents (people report to people)' : 'Agents';
  const options: SelectOption[] =
    subject.kind === 'person' ? [{ value: TOP, label: 'No one: the top of the chart' }] : [];
  for (const kind of ['person', 'agent'] as const) {
    for (const node of nodes) {
      if (node.kind !== kind || node.principalId === subject.principalId) continue;
      const you = node.kind === 'person' && node.person.userId === meUserId ? ' (you)' : '';
      const title = node.title
        ? ` · ${node.title}`
        : node.kind === 'agent'
          ? ` · ${node.agent.roleTitle}`
          : '';
      const loop = team.has(node.principalId);
      const offLimits = loop || (subject.kind === 'person' && kind === 'agent');
      options.push({
        value: node.principalId,
        label: `${nodeName(node)}${you}${title}${loop ? ' (below them)' : ''}`,
        group: kind === 'person' ? 'People' : agentsGroup,
        ...(offLimits ? { disabled: true } : {}),
      });
    }
  }
  return options;
}
