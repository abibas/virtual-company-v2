import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { formatTime } from '../data/format.ts';
import { BrandMark } from '../layout/Brand.tsx';
import { Avatar } from '../ui/Avatar.tsx';
import type { IconComponent } from '../ui/icon.ts';
import { AgentIcon, type AgentIconSubject } from './AgentIcon.tsx';

/**
 * Where a person wrote a message when not here (2026-11-13: a Slack message an agent answers): the place's name and
 * mark, and since 2026-11-14 the message's address there.
 */
export interface OutsidePlace {
  readonly label: string;
  readonly mark?: IconComponent | undefined;
  readonly link?: string | null | undefined;
}

/** Who wrote a message: an agent (its icon), a person (their photo or initials), or Most Wanted itself (its mark). */
export type MessageAuthorView =
  | { readonly kind: 'agent'; readonly name: string; readonly agent: AgentIconSubject }
  | {
      readonly kind: 'person';
      readonly name: string;
      readonly imageUrl?: string | null | undefined;
      readonly via?: OutsidePlace | undefined;
      /** Their page (2026-11-14: a contact's), which their name links to. */
      readonly href?: string | undefined;
    }
  | { readonly kind: 'system'; readonly name: string };

/** The outside place beside the name: its mark and name, linking to the message there when it has one. */
function ViaPlace({ via }: { readonly via: OutsidePlace }) {
  const Mark = via.mark;
  const classes = 'inline-flex shrink-0 items-center gap-1 text-xs text-dim';
  if (!via.link) return <span className={classes}>via {via.label}</span>;
  return (
    <a
      href={via.link}
      target="_blank"
      rel="noreferrer"
      title={`Open in ${via.label}`}
      className={cx(classes, 'rounded-xs hover:text-ink focus-visible:text-ink')}
    >
      {Mark && <Mark size={12} aria-hidden="true" />}
      {via.label}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

/** The author's name, linking to their page when they have one. */
function AuthorName({ author }: { readonly author: MessageAuthorView }) {
  const href = author.kind === 'person' ? author.href : undefined;
  if (href === undefined)
    return <span className="truncate text-sm font-semibold text-ink">{author.name}</span>;
  return (
    <Link
      to={href}
      className="truncate rounded-xs text-sm font-semibold text-ink hover:text-teal focus-visible:text-teal"
    >
      {author.name}
    </Link>
  );
}

/** Most Wanted as the author of the messages it writes itself (a team chat's wake-ups). */
export const SYSTEM_AUTHOR: MessageAuthorView = { kind: 'system', name: 'Most Wanted' };

/** The author's face: 28 px in a full thread, 24 px when `dense` (the right rail). Decorative: the name goes with it. */
export function MessageFace({
  author,
  dense = false,
  own = false,
}: {
  readonly author: MessageAuthorView;
  readonly dense?: boolean;
  /** The reader: their initials on the brand gradient, as in the top bar. */
  readonly own?: boolean;
}) {
  if (author.kind === 'system') return <BrandMark size={dense ? 'xs' : 'sm'} className="shadow-none" />;
  const size = dense ? 'xs' : 'xs-sm';
  if (author.kind === 'agent') return <AgentIcon agent={author.agent} size={size} />;
  return <Avatar name={author.name} src={author.imageUrl} size={size} tone={own ? 'gradient' : 'tint'} />;
}

/** How far a message's body sits in from its side: past the face and the gap after it. */
const INDENT = {
  start: { full: 'pl-[2.375rem]', dense: 'pl-8' },
  end: { full: 'pr-[2.375rem]', dense: 'pr-8' },
} as const;

export interface MessageAuthorProps {
  readonly author: MessageAuthorView;
  /** When it was written (ISO); none leaves the time out. */
  readonly at?: string | undefined;
  /** `end`: the reader's own message, its face on the right and the body under the name from that side. */
  readonly side?: 'start' | 'end';
  readonly dense?: boolean;
  readonly className?: string;
  /** The message: everything under the name, indented past the face. */
  readonly children: ReactNode;
}

/**
 * A message group in a thread: the author's face beside their name and time, the message under the name, indented
 * past the face, so the face shows once however many parts follow. The reader's own messages mirror it on the right.
 */
export function MessageAuthor({
  author,
  at,
  side = 'start',
  dense = false,
  className,
  children,
}: MessageAuthorProps) {
  const end = side === 'end';
  return (
    <div className={cx('grid min-w-0', dense ? 'gap-1' : 'gap-1.5', className)}>
      <div
        className={cx('flex min-w-0 items-center', dense ? 'gap-2' : 'gap-2.5', end && 'flex-row-reverse')}
      >
        <MessageFace author={author} dense={dense} own={end} />
        <div className={cx('flex min-w-0 items-baseline gap-2', end && 'flex-row-reverse')}>
          <AuthorName author={author} />
          {author.kind === 'person' && author.via && <ViaPlace via={author.via} />}
          {at && (
            <time dateTime={at} className="shrink-0 text-xs text-faint tabular">
              {formatTime(at)}
            </time>
          )}
        </div>
      </div>
      <div
        className={cx(
          'grid min-w-0 gap-1',
          INDENT[side][dense ? 'dense' : 'full'],
          end && 'justify-items-end',
        )}
      >
        {children}
      </div>
    </div>
  );
}
