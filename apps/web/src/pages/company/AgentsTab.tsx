import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import type { FlowSummary } from '../../api/flows.ts';
import { useCompanyLogo } from '../../api/images/company-logo.ts';
import { useAgentList, useOrgChart } from '../../api/org.ts';
import type { AgentFilter } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { AgentsView, type AgentsTab as Tab } from '../../features/agents/AgentsView.tsx';
import { companyAgentLinks } from '../../features/agents/links.ts';
import { chartFlowItems } from '../../features/flows/access.ts';
import { companyFlowLinks } from '../../features/flows/links.ts';
import { useHighlightedFlow } from '../../features/structure/flow/use-highlighted-flow.ts';

/**
 * The Org chart (`/:slug/structure`: the canvas, where people and agents are dragged to another manager, added,
 * titled and changed from their cards, and `?flow=<lead>` highlights a flow's members) and Agents
 * (`/:slug/structure/agents`: the agents by status) tabs of the Company structure page. `flows`: the company's flows,
 * which the page reads once for its flow picker too.
 */
export function AgentsTab({
  tab,
  flows,
}: {
  readonly tab: Tab;
  readonly flows: readonly FlowSummary[] | undefined;
}) {
  const { membership, me, agents: team, reload } = useCompany();
  const { companyId } = membership;
  const [status, setStatus] = useState<AgentFilter>('active');
  const chart = useOrgChart(companyId);
  const agents = useAgentList(companyId, status);
  const logo = useCompanyLogo(companyId, membership.logo?.version);
  const focus = useHighlightedFlow(companyId, flows, tab === 'chart');
  const viewer = { role: membership.role, userId: me.user.id, chart: chart.data };
  return (
    <AgentsView
      companyId={companyId}
      tab={tab}
      links={companyAgentLinks(membership.slug)}
      chart={chart}
      agents={agents}
      status={status}
      onStatus={setStatus}
      admin={roleAtLeast(membership.role, 'admin')}
      myRole={membership.role}
      meUserId={me.user.id}
      company={{ name: membership.name, logo }}
      flowItem={chartFlowItems(viewer, flows, companyFlowLinks(membership.slug))}
      focus={focus}
      onChanged={(self) => {
        chart.reload();
        agents.reload();
        team.reload();
        if (self) void reload().catch(() => undefined);
      }}
    />
  );
}
