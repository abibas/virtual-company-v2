import { Bot, Layers, Plus } from 'lucide-react';
import type { Agent, AgentFilter, AgentList, ChartNode } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { Link } from '../../app/router.tsx';
import { type Column, DataTable, Primary } from '../../components/data/DataTable.tsx';
import { LoadState } from '../../components/data/LoadState.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { effortLabel, modelLabel, profileLabel } from '../../components/org/agent-labels.ts';
import { nodeName } from '../../components/org/chart.ts';
import { AgentAvatar } from '../../components/org/OrgNodeCard.tsx';
import { Badge, StatusPill } from '../../components/ui/Badge.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import { ChatButton } from '../chats/ChatButton.tsx';
import { placementLine } from '../placements/placement-draft.ts';
import type { AgentLinks } from './links.ts';

const FILTERS: readonly SegmentOption<AgentFilter>[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

const NONE: Readonly<Record<AgentFilter, string>> = {
  active: 'No active agents',
  paused: 'No paused agents',
  archived: 'No archived agents',
  all: 'No agents yet',
};

/** The access profile its runs use, as a small badge with its owner on hover, or None. */
function ProfileCell({ profile }: { readonly profile: Agent['profile'] }) {
  if (!profile) return <span className="text-dim">None</span>;
  return (
    <span title={profileLabel(profile)}>
      <Badge size="sm" icon={Layers}>
        {profile.name}
      </Badge>
    </span>
  );
}

/** The machine it runs on and how, or Nowhere yet in grey. */
function MachineCell({ placement }: { readonly placement: Agent['placement'] }) {
  if (!placement) return <span className="text-dim">Nowhere yet</span>;
  return <span title={placementLine(placement)}>{placement.machineName}</span>;
}

/**
 * The columns: the agent (face, name, slug), its role, status, model, effort, access profile, machine and manager, and
 * its Chat button.
 */
function agentColumns(links: AgentLinks, managerOf: (agent: Agent) => string): readonly Column<Agent>[] {
  return [
    {
      key: 'agent',
      header: 'Agent',
      cell: (agent) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <AgentAvatar agent={agent} size="sm" />
          <Primary
            title={
              <Link to={links.agent(agent)} className="rounded-xs hover:text-teal focus-visible:text-teal">
                {agent.name}
              </Link>
            }
            subtitle={<span className="font-mono">{agent.slug}</span>}
            phone={
              <>
                <span>{agent.roleTitle}</span>
                <StatusPill status={agent.status} size="sm" />
              </>
            }
          />
        </div>
      ),
    },
    { key: 'role', header: 'Role title', hide: 'md', cell: (agent) => agent.roleTitle },
    { key: 'status', header: 'Status', hide: 'md', cell: (agent) => <StatusPill status={agent.status} /> },
    {
      key: 'model',
      header: 'Model',
      className: 'whitespace-nowrap font-mono text-xs leading-[1.6]',
      cell: (agent) => modelLabel(agent.model),
    },
    { key: 'effort', header: 'Effort', hide: 'sm', cell: (agent) => effortLabel(agent.effort) },
    {
      key: 'profile',
      header: 'Profile',
      hide: 'lg',
      cell: (agent) => <ProfileCell profile={agent.profile} />,
    },
    {
      key: 'machine',
      header: 'Machine',
      hide: 'lg',
      cell: (agent) => <MachineCell placement={agent.placement} />,
    },
    { key: 'manager', header: 'Reports to', hide: 'lg', cell: managerOf },
    {
      key: 'actions',
      header: 'Actions',
      srOnly: true,
      align: 'right',
      cell: (agent) => <ChatButton href={links.chats(agent)} placed={agent.placement !== null} />,
    },
  ];
}

/** The Agents tab: every agent with its status, model, effort and manager, filtered by status. */
export function AgentsTable({
  loaded,
  status,
  onStatus,
  nodes,
  links,
  admin,
}: {
  readonly loaded: Loaded<AgentList>;
  readonly status: AgentFilter;
  readonly onStatus: (status: AgentFilter) => void;
  /** The chart's places by principal id, to name each agent's manager. */
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly links: AgentLinks;
  readonly admin: boolean;
}) {
  const managerOf = (agent: Agent) => {
    const manager = agent.reportsTo ? nodes.get(agent.reportsTo) : undefined;
    return manager ? nodeName(manager) : agent.status === 'archived' ? 'Off the chart' : '—';
  };
  const hire = admin && (status === 'active' || status === 'all') && (
    <ButtonLink href={links.hire} tone="primary" icon={Plus}>
      Hire an agent
    </ButtonLink>
  );
  return (
    <Panel
      title="Agents"
      description="Every agent of the company: what it is, what powers it and who it reports to."
      actions={
        <SegmentedControl options={FILTERS} value={status} onChange={onStatus} label="Status" size="sm" />
      }
    >
      <LoadState loaded={loaded} label="Loading the agents…" skeleton={<SkeletonRows />}>
        {(data) => (
          <DataTable
            columns={agentColumns(links, managerOf)}
            rows={data.agents}
            rowKey={(agent) => agent.id}
            empty={
              <EmptyState icon={Bot} tone="teal" title={NONE[status]} size="sm" action={hire}>
                {status === 'archived' ? 'Archived agents leave the chart and can be restored.' : undefined}
              </EmptyState>
            }
          />
        )}
      </LoadState>
    </Panel>
  );
}
