import { roleAtLeast } from '@mwc/shared/roles';
import { useFlows } from '../../api/flows.ts';
import { useCompany } from '../../app/company.ts';
import { companyAgentLinks } from '../../features/agents/links.ts';
import { FlowPicker } from '../../features/structure/flow/FlowPicker.tsx';
import { type StructureTab, StructureView } from '../../features/structure/StructureView.tsx';
import { AgentsTab } from './AgentsTab.tsx';
import { PeopleTab } from './PeopleTab.tsx';

/**
 * `/:slug/structure` and its tabs: who is in the company, people and agents, and who reports to whom. The org chart
 * (`/:slug/structure`, `?flow=<lead>` highlighting a flow), the agents (`/agents`) and the people with their roles and
 * invitations (`/people`).
 */
export function StructurePage({ tab }: { readonly tab: StructureTab }) {
  const { membership } = useCompany();
  const links = companyAgentLinks(membership.slug);
  const flows = useFlows(membership.companyId);
  const list = flows.data?.flows;
  return (
    <StructureView
      tab={tab}
      links={links}
      hireHref={links.hire}
      admin={roleAtLeast(membership.role, 'admin')}
      tools={tab === 'chart' && list && list.length > 0 ? <FlowPicker flows={list} /> : undefined}
    >
      {tab === 'people' ? <PeopleTab /> : <AgentsTab tab={tab === 'chart' ? 'chart' : 'list'} flows={list} />}
    </StructureView>
  );
}
