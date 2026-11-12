import type { ReactNode } from 'react';
import { formatTime } from '../data/format.ts';
import { cx } from '../cx.ts';
import { BrandMark } from '../layout/Brand.tsx';
import { Avatar } from '../ui/Avatar.tsx';
import { AgentIcon, type AgentIconSubject } from './AgentIcon.tsx';

/** Who wrote a message: an agent (its icon), a person (their photo or initials), or Most Wanted itself (its mark). */
export type MessageAuthorView =
  | { readonly kind: 'agent'; readonly name: string; readonly agent: AgentIconSubject }
  | { readonly kind: 'person'; readonly name: string; readonly imageUrl?: string | null | undefined }
  | { readonly kind: 'system'; readonly name: string };

/** Most Wanted as the author of the messages it writes itself (a team chat's wake-ups). */
export const SYSTEM_AUTHOR: MessageAuthorView = { kind: 'system', name: 'Most Wanted' };

/** The author's face: 28 px in a full thread, 24 px when `dense` (the right rail). Decorative: the name goes with it. */
export function MessageFace({
  author,
  dense = false,
}: {
  readonly author: MessageAuthorView;
  readonly dense?: boolean;
}) {
  if (author.kind === 'system') return <BrandMark size={dense ? 'xs' : 'sm'} className="shadow-none" />;
  const size = dense ? 'xs' : 'xs-sm';
  if (author.kind === 'agent') return <AgentIcon agent={author.agent} size={size} />;
  return <Avatar name={author.name} src={author.imageUrl} size={size} />;
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
        <MessageFace author={author} dense={dense} />
        <div className={cx('flex min-w-0 items-baseline gap-2', end && 'flex-row-reverse')}>
          <span className="truncate text-sm font-semibold text-ink">{author.name}</span>
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
