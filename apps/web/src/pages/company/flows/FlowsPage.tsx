import { useFlowCounts, useFlows } from '../../../api/flows.ts';
import { useOrgChart } from '../../../api/org.ts';
import { useCompany } from '../../../app/company.ts';
import { companyFlowLinks } from '../../../features/flows/links.ts';
import { FlowsView } from '../../../features/flows/list/FlowsView.tsx';

/** `/:slug/flows`: every team's flow, with "Create a flow" for a manager without one. */
export function FlowsPage() {
  const { membership, me } = useCompany();
  const { companyId } = membership;
  const flows = useFlows(companyId);
  const chart = useOrgChart(companyId);
  return (
    <FlowsView
      companyId={companyId}
      flows={flows}
      chart={chart.data}
      viewer={{ role: membership.role, userId: me.user.id, chart: chart.data }}
      links={companyFlowLinks(membership.slug)}
      useBoard={useFlowCounts}
    />
  );
}
