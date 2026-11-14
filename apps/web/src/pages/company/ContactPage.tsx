import { roleAtLeast } from '@mwc/shared/roles';
import { type ContactDetail, useContact, useContactChange } from '../../api/contacts.ts';
import { useCompany } from '../../app/company.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Breadcrumbs } from '../../components/layout/Breadcrumbs.tsx';
import { ContactAgents } from '../../features/contacts/ContactAgents.tsx';
import { ContactConversations } from '../../features/contacts/ContactConversations.tsx';
import { ContactDecisions } from '../../features/contacts/ContactDecisions.tsx';
import { ContactHeader } from '../../features/contacts/ContactHeader.tsx';
import { ContactNote } from '../../features/contacts/ContactNote.tsx';
import { contactsListPath } from '../../features/contacts/links.ts';

/** The page's parts once the contact is loaded. */
function ContactView({
  detail,
  onChanged,
}: {
  readonly detail: ContactDetail;
  readonly onChanged: () => void;
}) {
  const { membership } = useCompany();
  const change = useContactChange(membership.companyId);
  const { contact } = detail;
  const names = new Map(detail.conversations.map(({ agent }) => [agent.id, agent.name]));
  return (
    <div className="grid gap-4 md:gap-5">
      <Breadcrumbs
        items={[{ label: 'Contacts', href: contactsListPath(membership.slug) }, { label: contact.name }]}
      />
      <ContactHeader contact={contact} />
      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ContactConversations contact={contact} conversations={detail.conversations} slug={membership.slug} />
        <div className="grid gap-4 md:gap-5">
          <ContactAgents agents={detail.agents} />
          <ContactNote
            key={contact.id}
            contact={contact}
            admin={roleAtLeast(membership.role, 'admin')}
            onChange={async (body) => {
              const saved = await change(contact.id, body);
              onChanged();
              return saved;
            }}
          />
          <ContactDecisions
            companyId={membership.companyId}
            companySlug={membership.slug}
            contactId={contact.id}
            agentName={(agentId) => names.get(agentId)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * `/:slug/contacts/:contactId` (2026-11-14, docs/subscriptions.md "Contacts"): a person outside the company who talked to
 * its agents. Their photo, name, title, email, Slack handle and first and last seen; their conversations with the
 * agents, the latest first, followed live; the counts per agent; the note and archive (admins and owners); and the
 * decisions agents recorded in their conversations.
 */
export function ContactPage({ contactId }: { readonly contactId: string }) {
  const { membership } = useCompany();
  const detail = useContact(membership.companyId, contactId);
  return (
    <LoadState loaded={detail} label="Loading the contact…">
      {(data) => <ContactView detail={data} onChanged={detail.reload} />}
    </LoadState>
  );
}
