import { roleAtLeast } from '@mwc/shared/roles';
import { useCompany } from '../../app/company.ts';
import { companyAgentLinks } from '../../features/agents/links.ts';
import { type StructureTab, StructureView } from '../../features/structure/StructureView.tsx';
import { AgentsTab } from './AgentsTab.tsx';
import { PeopleTab } from './PeopleTab.tsx';

/**
 * `/:slug/structure` and its tabs: who is in the company, people and agents, and who reports to whom. The org chart
 * (`/:slug/structure`), the agents (`/agents`) and the people with their roles and invitations (`/people`).
 */
export function StructurePage({ tab }: { readonly tab: StructureTab }) {
  const { membership } = useCompany();
  const links = companyAgentLinks(membership.slug);
  return (
    <StructureView
      tab={tab}
      links={links}
      hireHref={links.hire}
      admin={roleAtLeast(membership.role, 'admin')}
    >
      {tab === 'people' ? <PeopleTab /> : <AgentsTab tab={tab === 'chart' ? 'chart' : 'list'} />}
    </StructureView>
  );
}
