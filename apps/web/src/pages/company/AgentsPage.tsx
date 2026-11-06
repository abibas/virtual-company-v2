import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import { useAgentList, useOrgChart } from '../../api/org.ts';
import type { AgentFilter } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { useLocation } from '../../app/router.tsx';
import { AgentsView } from '../../features/agents/AgentsView.tsx';
import { companyAgentLinks } from '../../features/agents/links.ts';

/**
 * `/:slug/agents`: the org chart (people and agents, moved and titled from their cards) and, with `?view=list`, the
 * list of agents by status. Admins and owners hire agents from here.
 */
export function AgentsPage() {
  const { membership, me, agents: team } = useCompany();
  const { companyId } = membership;
  const { search } = useLocation();
  const [status, setStatus] = useState<AgentFilter>('active');
  const chart = useOrgChart(companyId);
  const agents = useAgentList(companyId, status);
  return (
    <AgentsView
      companyId={companyId}
      tab={search.get('view') === 'list' ? 'list' : 'chart'}
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
