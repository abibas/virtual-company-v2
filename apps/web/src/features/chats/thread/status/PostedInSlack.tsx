import { ExternalLink } from 'lucide-react';
import { SlackMark } from '../../../../components/ui/ProviderLogo.tsx';

/**
 * Where a reply was posted outside (2026-11-14, docs/subscriptions.md "Contacts"): a Slack message's answer, in its
 * thread or DM. "Posted in Slack" under the reply, linking to the post there; "Sent in Slack" under a message its
 * Slack connection's owner sent there from the chat (2026-11-14).
 */
export function PostedInSlack({
  link,
  words = 'Posted in Slack',
}: {
  readonly link: string;
  /** "Sent in Slack" for a person's own message sent there (2026-11-14). */
  readonly words?: string;
}) {
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      title="Open it in Slack"
      className="inline-flex shrink-0 items-center gap-1 rounded-xs text-xs text-dim hover:text-ink focus-visible:text-ink"
    >
      <SlackMark size={12} aria-hidden="true" />
      {words}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}
