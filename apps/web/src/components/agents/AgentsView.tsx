import { Bot, Network, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useApi } from '../../api/context.ts';
import { orgCalls } from '../../api/org.ts';
import type { AgentFilter, AgentList, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { Tabs } from '../forms/Segmented.tsx';
import { PageHeader } from '../layout/PageHeader.tsx';
import { nodesById } from '../org/chart.ts';
import { ButtonLink } from '../ui/Button.tsx';
import { AgentsTable } from './AgentsTable.tsx';
import type { AgentLinks } from './links.ts';
import { OrgChartPanel } from './OrgChartPanel.tsx';

export type AgentsTab = 'chart' | 'list';

export interface AgentsViewProps {
  readonly companyId: string;
  readonly tab: AgentsTab;
  readonly links: AgentLinks;
  readonly chart: Loaded<OrgChart>;
  /** The list tab's agents, of the chosen status. */
  readonly agents: Loaded<AgentList>;
  readonly status: AgentFilter;
  readonly onStatus: (status: AgentFilter) => void;
  readonly admin: boolean;
  readonly meUserId: string;
  readonly imageOf?: ((userId: string) => string | null | undefined) | undefined;
  /** Someone moved or got a title: read the chart and the team again. */
  readonly onChanged: () => void;
}

/**
 * The Agents page: its header with Hire an agent (admins), the two tabs, and the org chart or the list of agents.
 * The company's route and the design gallery both render it, with live data or with samples.
 */
export function AgentsView({
  companyId,
  tab,
  links,
  chart,
  agents,
  status,
  onStatus,
  admin,
  ...rest
}: AgentsViewProps) {
  const api = useApi();
  const calls = useMemo(() => orgCalls(api, companyId), [api, companyId]);
  const nodes = useMemo(() => nodesById(chart.data?.nodes ?? []), [chart.data]);
  return (
    <>
      <PageHeader
        title="Agents"
        actions={
          admin && (
            <ButtonLink href={links.hire} tone="primary" icon={Plus}>
              Hire an agent
            </ButtonLink>
          )
        }
      >
        <p>
          {admin
            ? 'Your AI team beside the people: hire agents, place them on the chart and give everyone a title.'
            : 'The people and the AI agents of the company, and who reports to whom.'}
        </p>
      </PageHeader>
      <Tabs
        label="Agents views"
        className="mb-4"
        items={[
          { href: links.chart, label: 'Org chart', icon: Network, current: tab === 'chart' },
          { href: links.list, label: 'Agents', icon: Bot, current: tab === 'list' },
        ]}
      />
      {tab === 'chart' ? (
        <OrgChartPanel loaded={chart} admin={admin} calls={calls} links={links} {...rest} />
      ) : (
        <AgentsTable
          loaded={agents}
          status={status}
          onStatus={onStatus}
          nodes={nodes}
          links={links}
          admin={admin}
        />
      )}
    </>
  );
}
