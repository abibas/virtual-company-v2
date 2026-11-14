import { Mail } from 'lucide-react';
import type { Contact } from '../../api/contacts.ts';
import { formatDate, formatDateTime } from '../../components/data/format.ts';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { SlackMark } from '../../components/ui/ProviderLogo.tsx';

/** A moment as a date, its time on hover. */
function When({ at }: { readonly at: string }) {
  return (
    <time dateTime={at} title={formatDateTime(at)}>
      {formatDate(at)}
    </time>
  );
}

/**
 * The top of a contact's page (2026-11-14, docs/subscriptions.md "Contacts"): their Slack photo, name and title, their
 * email and Slack handle, and when they were first and last seen; Archived when they are.
 */
export function ContactHeader({ contact }: { readonly contact: Contact }) {
  return (
    <Card as="section" aria-label={contact.name} padding="lg">
      <div className="flex flex-wrap items-start gap-4 md:gap-5">
        <Avatar name={contact.name} src={contact.avatarUrl} size="xl" className="shadow-card" />
        <div className="min-w-0 flex-1">
          {contact.archivedAt && (
            <Badge size="sm" className="mb-2">
              Archived
            </Badge>
          )}
          <h1 className="text-3xl font-extrabold tracking-[-0.03em] break-words text-ink">{contact.name}</h1>
          {contact.title && <p className="mt-0.5 text-md text-ink-2">{contact.title}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1.5 rounded-xs text-ink-2 hover:text-ink"
              >
                <Mail size={14} aria-hidden="true" className="text-dim" />
                {contact.email}
              </a>
            )}
            {contact.slack && (
              <span className="inline-flex items-center gap-1.5 text-ink-2" title={contact.slack.userId}>
                <SlackMark size={14} aria-hidden="true" />
                {contact.handle ? `@${contact.handle}` : contact.slack.userId}
              </span>
            )}
          </div>
        </div>
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-dim">First seen</dt>
          <dd className="font-medium text-ink">
            <When at={contact.firstSeenAt} />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-dim">Last seen</dt>
          <dd className="font-medium text-ink">
            <When at={contact.lastSeenAt} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}
