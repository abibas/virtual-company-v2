import { roleAtLeast } from '@mwc/shared/roles';
import { useFlows } from '../../api/flows.ts';
import { useCompany } from '../../app/company.ts';
import { companyAgentLinks } from '../../features/agents/links.ts';
import { contactPath } from '../../features/contacts/links.ts';
import { FlowPicker } from '../../features/structure/flow/FlowPicker.tsx';
import { RequestersToggle } from '../../features/structure/requesters/RequestersToggle.tsx';
import { useRequesters } from '../../features/structure/requesters/use-requesters.ts';
import { type StructureTab, StructureView } from '../../features/structure/StructureView.tsx';
import { AgentsTab } from './AgentsTab.tsx';
import { ContactsTab } from './ContactsTab.tsx';
import { PeopleTab } from './PeopleTab.tsx';

/**
 * `/:slug/structure` and its tabs: who is in the company, people and agents, and who reports to whom. The org chart
 * (`/:slug/structure`, `?flow=<lead>` highlighting a flow), the agents (`/agents`), the people with their roles and
 * invitations (`/people`) and the contacts, the people outside it who talked to its agents (`/contacts`, 2026-11-14).
 * The chart shows those contacts too, in its Requesters column (`?requesters=0` hides it, `24h` or `30d` sets its window).
 */
export function StructurePage({ tab }: { readonly tab: StructureTab }) {
  const { membership } = useCompany();
  const links = companyAgentLinks(membership.slug);
  const flows = useFlows(membership.companyId);
  const list = flows.data?.flows;
  const member = roleAtLeast(membership.role, 'member');
  const requesters = useRequesters(membership.companyId, member && tab === 'chart', {
    contactHref: (id) => contactPath(membership.slug, id),
    moreHref: links.contacts,
  });
  const tools = tab === 'chart' && (
    <>
      {list && list.length > 0 && <FlowPicker flows={list} />}
      {requesters.offered && <RequestersToggle />}
    </>
  );
  return (
    <StructureView
      tab={tab}
      links={links}
      hireHref={links.hire}
      admin={roleAtLeast(membership.role, 'admin')}
      hidden={member ? [] : ['contacts']}
      tools={tools || undefined}
    >
      {tab === 'people' && <PeopleTab />}
      {tab === 'contacts' && <ContactsTab />}
      {(tab === 'chart' || tab === 'agents') && (
        <AgentsTab tab={tab === 'chart' ? 'chart' : 'list'} flows={list} requesters={requesters.chart} />
      )}
    </StructureView>
  );
}
