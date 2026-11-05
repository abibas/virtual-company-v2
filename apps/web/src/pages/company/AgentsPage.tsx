import { roleAtLeast } from '@mwc/shared/roles';
import { useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import { useAgentList, useOrgChart } from '../../api/org.ts';
import type { AgentFilter } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { useLocation } from '../../app/router.tsx';
import { AgentsView } from '../../components/agents/AgentsView.tsx';
import { companyAgentLinks } from '../../components/agents/links.ts';

/** The members' pictures by user id, for the people on the chart (the chart itself carries none). */
function useMemberImages(companyId: string) {
  const api = useApi();
  const members = useLoad(`agents:members:${companyId}`, () =>
    call(api.api.companies[':companyId'].members.$get({ param: { companyId } })),
  );
  return useMemo(
    () => new Map((members.data?.members ?? []).map((member) => [member.userId, member.imageUrl])),
    [members.data],
  );
}

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
  const images = useMemberImages(companyId);
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
      imageOf={(userId) => images.get(userId)}
      onChanged={() => {
        chart.reload();
        agents.reload();
        team.reload();
      }}
    />
  );
}
