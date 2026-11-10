import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import { useCompanyLogo } from '../../api/company-logo.ts';
import { useAgentList, useOrgChart } from '../../api/org.ts';
import type { AgentFilter } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { AgentsView, type AgentsTab as Tab } from '../../features/agents/AgentsView.tsx';
import { companyAgentLinks } from '../../features/agents/links.ts';

/**
 * The Org chart (`/:slug/structure`: the canvas, where people and agents are dragged to another manager, added,
 * titled and changed from their cards) and Agents
 * (`/:slug/structure/agents`: the agents by status) tabs of the Company structure page.
 */
export function AgentsTab({ tab }: { readonly tab: Tab }) {
  const { membership, me, agents: team, reload } = useCompany();
  const { companyId } = membership;
  const [status, setStatus] = useState<AgentFilter>('active');
  const chart = useOrgChart(companyId);
  const agents = useAgentList(companyId, status);
  const logo = useCompanyLogo(companyId, membership.logo?.version);
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
      onChanged={(self) => {
        chart.reload();
        agents.reload();
        team.reload();
        if (self) void reload().catch(() => undefined);
      }}
    />
  );
}
