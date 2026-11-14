import { BookUser } from 'lucide-react';
import type { ContactListItem } from '../../api/contacts.ts';
import type { Loaded } from '../../api/use-load.ts';
import { formatDateTime, fromNow } from '../../components/data/format.ts';
import { List, ListRow } from '../../components/data/List.tsx';
import { LoadState } from '../../components/data/LoadState.tsx';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import { contactPath } from './links.ts';
import { useAgentFaces } from './use-agent-faces.ts';

/** Which contacts the list shows: the current ones, or the archived ones too. */
export type ContactsShown = 'current' | 'all';

const SHOWN: readonly SegmentOption<ContactsShown>[] = [
  { value: 'current', label: 'Current' },
  { value: 'all', label: 'With archived' },
];

/** The most agents' faces a row shows. */
const FACES_MAX = 4;

/** One contact: their photo, name, title and Slack handle; the agents they talked to and when they were last seen. */
function ContactRow({ contact, slug }: { readonly contact: ContactListItem; readonly slug: string }) {
  const faceOf = useAgentFaces();
  const subtitle = [contact.title, contact.handle && `@${contact.handle}`, contact.archivedAt && 'Archived']
    .filter(Boolean)
    .join(' · ');
  const agents = contact.agentIds.slice(0, FACES_MAX);
  return (
    <ListRow
      href={contactPath(slug, contact.id)}
      leading={<Avatar name={contact.name} src={contact.avatarUrl} size="md" />}
      title={contact.name}
      subtitle={subtitle || undefined}
      trailing={
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden items-center -space-x-1.5 sm:flex">
            {agents.map((agentId) => (
              <AgentIcon key={agentId} agent={faceOf({ id: agentId, name: 'Agent' })} size="xs" />
            ))}
            {contact.agentIds.length > FACES_MAX && (
              <span className="pl-2.5 text-xs text-dim">+{contact.agentIds.length - FACES_MAX}</span>
            )}
          </span>
          <time
            dateTime={contact.lastSeenAt}
            title={formatDateTime(contact.lastSeenAt)}
            className="w-20 text-right text-xs text-dim"
          >
            {fromNow(contact.lastSeenAt)}
          </time>
        </span>
      }
    />
  );
}

/**
 * The Contacts tab of Company structure (2026-11-14, docs/subscriptions.md "Contacts"): the people outside the company
 * who talked to its agents, the latest seen first, each opening their page; the archived ones with "With archived".
 */
export function ContactsList({
  loaded,
  shown,
  onShown,
  slug,
}: {
  readonly loaded: Loaded<{ readonly contacts: readonly ContactListItem[] }>;
  readonly shown: ContactsShown;
  readonly onShown: (shown: ContactsShown) => void;
  readonly slug: string;
}) {
  return (
    <Panel
      title="Contacts"
      padding="sm"
      actions={
        <SegmentedControl options={SHOWN} value={shown} onChange={onShown} label="Contacts shown" size="sm" />
      }
    >
      <LoadState loaded={loaded} label="Loading the contacts…" skeleton={<SkeletonRows />}>
        {(data) =>
          data.contacts.length === 0 ? (
            <EmptyState icon={BookUser} title="No contacts yet" size="sm">
              A person appears here when their Slack message wakes an agent.
            </EmptyState>
          ) : (
            <List divided>
              {data.contacts.map((contact) => (
                <ContactRow key={contact.id} contact={contact} slug={slug} />
              ))}
            </List>
          )
        }
      </LoadState>
    </Panel>
  );
}
