import { useMemo } from 'react';
import { useApi } from '../../api/context.ts';
import { orgCalls } from '../../api/org.ts';
import type { AgentFilter, AgentList, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { nodesById } from '../../components/org/chart.ts';
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
  /** Someone moved or got a title: read the chart and the team again. */
  readonly onChanged: () => void;
}

/**
 * The body of the Company structure page's Org chart and Agents tabs: the org chart or the list of agents. The
 * company's route and the design gallery both render it, with live data or with samples.
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
  return tab === 'chart' ? (
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
  );
}
