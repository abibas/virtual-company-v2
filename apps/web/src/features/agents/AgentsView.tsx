import type { MembershipRole } from '@mwc/shared/enums';
import { useMemo } from 'react';
import { useApi } from '../../api/context.ts';
import { orgCalls } from '../../api/org.ts';
import type { AgentFilter, AgentList, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { nodesById } from '../../components/org/chart.ts';
import { OrgChartBoard } from '../structure/OrgChartBoard.tsx';
import { AgentsTable } from './AgentsTable.tsx';
import type { AgentLinks } from './links.ts';

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
  /** The signed-in person's role: the roles they may give from the chart. */
  readonly myRole: MembershipRole;
  readonly meUserId: string;
  /** The company at the top of the chart: its name and its logo (an object URL, or null). */
  readonly company: { readonly name: string; readonly logo: string | null };
  /** Someone moved, got a title or a role: read the chart and the team again (`self`: one's own role changed). */
  readonly onChanged: (self?: boolean) => void;
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
  myRole,
  meUserId,
  company,
  onChanged,
}: AgentsViewProps) {
  const api = useApi();
  const calls = useMemo(() => orgCalls(api, companyId), [api, companyId]);
  const nodes = useMemo(() => nodesById(chart.data?.nodes ?? []), [chart.data]);
  return tab === 'chart' ? (
    <OrgChartBoard
      companyId={companyId}
      company={company}
      loaded={chart}
      calls={calls}
      links={links}
      abilities={{ admin, myRole, meUserId }}
      onChanged={onChanged}
    />
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
