import { ExternalLink } from 'lucide-react';
import { useCompany } from '../../../../app/company.ts';
import { companyPath } from '../../../../app/nav.ts';
import { Link } from '../../../../app/router.tsx';
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

/**
 * Why a reply was not posted in Slack (T-22), in its place under the reply: "Not posted in Slack: <reason>", linking
 * to the sign-ins page when a sign-in is at fault (its owner adds a new token there).
 */
export function NotPostedInSlack({
  failure,
}: {
  readonly failure: { readonly reason: string; readonly signIn: boolean };
}) {
  const { slug } = useCompany().membership;
  return (
    <span
      title={`Not posted in Slack: ${failure.reason}`}
      className="inline-flex min-w-0 shrink items-center gap-1 text-xs text-failed"
    >
      <SlackMark size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">Not posted in Slack: {failure.reason}</span>
      {failure.signIn && (
        <Link
          to={companyPath(slug, 'subscriptions')}
          className="shrink-0 font-semibold text-blue hover:underline"
        >
          Open sign-ins
        </Link>
      )}
    </span>
  );
}
