import { ExternalLink } from 'lucide-react';
import { SlackMark } from '../../../../components/ui/ProviderLogo.tsx';

/**
 * Where a reply was posted outside (2026-11-14, docs/subscriptions.md "Contacts"): a Slack message's answer, in its
 * thread or DM. "Posted in Slack" under the reply, linking to the post there.
 */
export function PostedInSlack({ link }: { readonly link: string }) {
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      title="Open the reply in Slack"
      className="inline-flex shrink-0 items-center gap-1 rounded-xs text-xs text-dim hover:text-ink focus-visible:text-ink"
    >
      <SlackMark size={12} aria-hidden="true" />
      Posted in Slack
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}
