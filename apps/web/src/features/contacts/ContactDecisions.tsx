import { Gavel } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

/**
 * The decisions made for a contact's requests (2026-11-14, docs/subscriptions.md "Contacts"). The hook for the decision
 * log, which lands on its own branch: it gives this section its list for the contact (`contactId`) and replaces the
 * empty state; until then there is no endpoint for it.
 */
export function ContactDecisions({ contactId: _contactId }: { readonly contactId: string }) {
  return (
    <Panel title="Decisions" padding="sm">
      <EmptyState icon={Gavel} title="No decisions yet" size="sm" />
    </Panel>
  );
}
