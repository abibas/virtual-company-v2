import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { count } from '../../../components/data/format.ts';
import { Avatar } from '../../../components/ui/Avatar.tsx';
import { SlackMark } from '../../../components/ui/ProviderLogo.tsx';
import { REQUESTER } from './requesters-layout.ts';

/**
 * A contact in the Requesters column: their Slack photo (a green dot while one of their turns waits or runs), their
 * name and title, and their requests in the window. Smaller than the people's and agents' cards, on a dashed outline
 * with the Slack mark, so it does not read as someone in the company. The whole card opens the contact's page.
 */
export function RequesterCard({
  name,
  title,
  avatarUrl,
  requests,
  span,
  live,
  href,
  onHover,
}: {
  readonly name: string;
  readonly title: string | null;
  readonly avatarUrl: string | null;
  readonly requests: number;
  /** The window, in words ("7 days"). */
  readonly span: string;
  readonly live: boolean;
  readonly href: string;
  /** The pointer or the focus came onto the card (true) or left it. */
  readonly onHover: (on: boolean) => void;
}) {
  const facts = `${count(requests, 'request')} · ${span}`;
  return (
    <Link
      to={href}
      draggable={false}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-label={`${name}, Slack contact: ${facts}${live ? ', being answered now' : ''}`}
      style={{ width: REQUESTER.width, height: REQUESTER.height }}
      className={cx(
        'group/req relative flex items-center gap-2.5 rounded-xl border border-dashed bg-surface px-3 transition-[border-color,box-shadow] duration-150 hover:shadow-card focus-visible:outline-2 focus-visible:outline-blue motion-reduce:transition-none',
        live ? 'border-done/60' : 'border-line-2 hover:border-ink-2/40',
      )}
    >
      <span className="relative inline-flex shrink-0">
        <Avatar name={name} src={avatarUrl} size="sm" />
        {live && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-done ring-2 ring-surface"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight font-bold text-ink group-hover/req:text-blue">
          {name}
        </span>
        {title && <span className="block truncate text-xs text-dim">{title}</span>}
        <span className="block truncate text-2xs font-medium text-ink-2 tabular-nums">{facts}</span>
      </span>
      <SlackMark size={12} className="absolute top-2 right-2 text-faint" />
    </Link>
  );
}
