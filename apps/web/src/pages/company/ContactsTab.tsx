import { useState } from 'react';
import { useContacts } from '../../api/contacts.ts';
import { useCompany } from '../../app/company.ts';
import { ContactsList, type ContactsShown } from '../../features/contacts/ContactsList.tsx';

/** The Contacts tab of Company structure (`/:slug/structure/contacts`, 2026-11-14): the company's contacts. */
export function ContactsTab() {
  const { membership } = useCompany();
  const [shown, setShown] = useState<ContactsShown>('current');
  const contacts = useContacts(membership.companyId, shown === 'all');
  return <ContactsList loaded={contacts} shown={shown} onShown={setShown} slug={membership.slug} />;
}
