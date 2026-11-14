import type { AgentStatus, Effort, MembershipRole } from '@mwc/shared/enums';
import type { ContactInteraction } from '../../api/contacts.ts';
import { ApiError } from '../../api/errors.ts';
import type {
  AgentDetail,
  AgentFilter,
  AgentList,
  ChartNode,
  OrgChart,
  OrgTreeNode,
} from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { nodesById } from '../../components/org/chart.ts';
import type { RequesterWindow } from '../../features/structure/requesters/requesters.ts';
import { days, loaded } from './records.ts';

/**
 * The org chart of the gallery: three people and five agents (the dock's sample agents), with a PM agent managing two
 * agents, an agent under a person who is not the owner, and a paused agent; one more agent is archived, off the chart.
 */

const person = (
  n: number,
  displayName: string,
  role: MembershipRole,
  title: string | null,
  reportsTo: string | null,
): ChartNode => ({
  principalId: `p-${n}`,
  kind: 'person',
  reportsTo,
  title,
  person: {
    userId: n === 1 ? 'u-ihor' : `u-${n}`,
    membershipId: `m-${n}`,
    displayName,
    email: `${displayName.split(' ')[0]?.toLowerCase()}@example.com`,
    imageUrl: null,
    role,
  },
});

interface SampleAgent {
  readonly slug: string;
  readonly name: string;
  readonly roleTitle: string;
  readonly face: number;
  readonly status: AgentStatus;
  readonly model: string;
  readonly effort: Effort;
  readonly reportsTo: string | null;
  readonly rev: number;
  readonly hired: number;
}

const sample = (
  [slug, name, roleTitle]: readonly [string, string, string],
  face: number,
  status: AgentStatus,
  [model, effort]: readonly [string, Effort],
  reportsTo: string | null,
  rev: number,
  hired: number,
): SampleAgent => ({ slug, name, roleTitle, face, status, model, effort, reportsTo, rev, hired });

const AGENTS: readonly SampleAgent[] = [
  sample(['vega', 'Vega', 'Platform PM'], 4, 'active', ['claude-opus-5-5', 'xhigh'], 'p-1', 3, 12),
  sample(['mason', 'Mason', 'Coder'], 1, 'active', ['claude-opus-5-5', 'high'], 'p-vega', 5, 11),
  sample(['pip', 'Pip', 'QA'], 3, 'paused', ['claude-haiku-5-5', 'medium'], 'p-vega', 2, 9),
  sample(['juno', 'Juno', 'Reviewer'], 2, 'active', ['claude-sonnet-5-5', 'high'], 'p-2', 1, 6),
  sample(['scout', 'Scout', 'Researcher'], 0, 'active', ['claude-fable-5-1', 'max'], 'p-1', 1, 3),
  sample(['echo', 'Echo', 'Release notes'], 5, 'archived', ['claude-sonnet-5-5', 'low'], null, 4, 30),
];

const agentNode = ({
  slug,
  name,
  roleTitle,
  face,
  status,
  model,
  effort,
  reportsTo,
}: SampleAgent): ChartNode => ({
  principalId: `p-${slug}`,
  kind: 'agent',
  reportsTo,
  title: null,
  agent: {
    agentId: `a-${slug}`,
    name,
    slug,
    roleTitle,
    status,
    harness: 'claude_code',
    face,
    icon: { kind: 'face' },
    profile: null,
    runsWith: { model, effort, mode: 'manual', provider: 'claude' },
    placement: slug === 'mason' ? { machineId: 'mc-1', machineName: 'Studio Mac', mode: 'host' } : null,
  },
});

const NODES: readonly ChartNode[] = [
  person(1, 'Ihor Herasko', 'owner', 'CEO', null),
  person(2, 'Olena Marsh', 'admin', 'Head of Product', 'p-1'),
  person(3, 'Theo Laurent', 'member', 'Designer', 'p-2'),
  ...AGENTS.filter((agent) => agent.status !== 'archived').map(agentNode),
];

/** The tree the server would build from the nodes. */
function treeOf(nodes: readonly ChartNode[], reportsTo: string | null = null): OrgTreeNode[] {
  return nodes
    .filter((node) => node.reportsTo === reportsTo)
    .map((node) => ({
      principalId: node.principalId,
      kind: node.kind,
      orphan: false,
      children: treeOf(nodes, node.principalId),
    }));
}

export const SAMPLE_CHART: OrgChart = { nodes: [...NODES], tree: treeOf(NODES) };

/** The chart's principals by id, as a page that loaded the chart keeps them. */
export const SAMPLE_NODES = nodesById(NODES);

const INSTRUCTIONS = `You are Vega, the platform team's PM.

- Take one ticket at a time from Ihor and split it into tasks for Mason (code) and Pip (tests).
- Send corrections back to the task that built the work, never as a new task.
- Never push, merge or touch production yourself.
- When a task is done, check it against the ticket and hand it to Ihor for review.`;

const detailOf = (agent: SampleAgent): AgentDetail => ({
  id: `a-${agent.slug}`,
  principalId: `p-${agent.slug}`,
  name: agent.name,
  slug: agent.slug,
  roleTitle: agent.roleTitle,
  status: agent.status,
  harness: 'claude_code',
  runsWith: { model: agent.model, effort: agent.effort, mode: 'manual', provider: 'claude' },
  instructionsRev: agent.rev,
  maxConcurrentRuns: agent.slug === 'mason' ? 3 : 1,
  face: agent.face,
  icon: { kind: 'face' },
  reportsTo: agent.reportsTo,
  title: null,
  profile: null,
  placement: agent.slug === 'mason' ? { machineId: 'm-mac', machineName: 'This Mac', mode: 'host' } : null,
  createdAt: days(-agent.hired),
  updatedAt: days(-1),
  instructions: agent.slug === 'vega' ? INSTRUCTIONS : '',
});

const DETAILS: readonly AgentDetail[] = AGENTS.map(detailOf);

/** `GET /agents?status=` on the samples. */
export function sampleAgentList(status: AgentFilter): AgentList {
  return { agents: DETAILS.filter((agent) => status === 'all' || agent.status === status) };
}

/** One sample agent by its address, or the refusal the API gives for none. */
export function sampleAgent(address: string): Loaded<AgentDetail> {
  const agent = DETAILS.find((candidate) => candidate.slug === address);
  if (agent) return loaded(agent);
  const error = new ApiError(404, 'agent_not_found', 'There is no agent at this address.');
  return { data: undefined, error, loading: false, reload: () => undefined };
}

/**
 * The Slack people who talked to the sample agents in the last 30 days: name, title, and per agent "slug messages
 * days-ago" (and "live" while a turn of theirs runs there).
 */
const REQUESTERS: readonly (readonly [string, string | null, string])[] = [
  ['Erich Novak', 'Solutions Engineer', 'mason 14 0 live, vega 5 1'],
  ['Sam Okafor', 'Partner, Northwind', 'scout 26 0'],
  ['Priya Raman', 'Customer Success', 'juno 9 2, scout 2 3'],
  ['Marco Bellini', 'Account Executive', 'vega 3 4'],
  ['Dana Whitfield', 'Support Lead', 'mason 2 5, pip 1 6'],
  ['Lea Brandt', null, 'juno 1 6'],
  ['Tomás Ferreira', 'Field Engineer', 'mason 6 9'],
  ['Hana Sato', 'Product Marketing', 'vega 4 11'],
  ['Owen Price', 'Legal', 'scout 3 13'],
  ['Ruth Adler', 'Finance', 'vega 2 15'],
  ['Kofi Mensah', 'Partner, Contoso', 'juno 2 18'],
  ['Ines Duarte', 'Recruiting', 'scout 1 21'],
  ['Viktor Hale', 'Security', 'mason 1 24'],
  ['Mia Laine', 'Design partner', 'juno 1 27'],
];

const requester = ([name, title, spec]: (typeof REQUESTERS)[number], n: number): ContactInteraction => {
  const agents = spec.split(', ').map((part) => {
    const [slug, messages, ago, live] = part.split(' ');
    return {
      agentId: `a-${slug}`,
      principalId: `p-${slug}`,
      messages: Number(messages),
      lastAt: days(-Number(ago)),
      live: live === 'live',
    };
  });
  const live = agents.some((agent) => agent.live);
  return { contact: { id: `ct-${n + 1}`, name, title, avatarUrl: null }, live, agents };
};

/** `GET …/contacts/interactions` on the samples for a window: 3 contacts in 24 hours, 6 in 7 days, 14 in 30. */
export function sampleInteractions(window: RequesterWindow): readonly ContactInteraction[] {
  const within = { '24h': 1, '7d': 7, '30d': 30 }[window];
  const latest = (spec: string) => Math.min(...spec.split(', ').map((part) => Number(part.split(' ')[2])));
  return REQUESTERS.map(requester).filter((_, n) => latest(REQUESTERS[n]?.[2] ?? '') < within);
}
