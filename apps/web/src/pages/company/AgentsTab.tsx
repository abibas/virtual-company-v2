import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import { useAgentList, useOrgChart } from '../../api/org.ts';
import type { AgentFilter } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { AgentsView, type AgentsTab as Tab } from '../../features/agents/AgentsView.tsx';
import { companyAgentLinks } from '../../features/agents/links.ts';

/**
 * The Org chart (`/:slug/structure`: people and agents, moved and titled from their cards) and Agents
 * (`/:slug/structure/agents`: the agents by status) tabs of the Company structure page.
 */
export function AgentsTab({ tab }: { readonly tab: Tab }) {
  const { membership, me, agents: team } = useCompany();
  const { companyId } = membership;
  const [status, setStatus] = useState<AgentFilter>('active');
  const chart = useOrgChart(companyId);
  const agents = useAgentList(companyId, status);
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
      meUserId={me.user.id}
      onChanged={() => {
        chart.reload();
        agents.reload();
        team.reload();
      }}
    />
  );
}
