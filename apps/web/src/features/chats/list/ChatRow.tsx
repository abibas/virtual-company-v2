import { Archive, BellRing, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { ChatListItem } from '../../../api/types.ts';
import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { fromNow } from '../../../components/data/format.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { CHAT_DOT_WORDS, type ChatDot } from '../chat-dots.ts';
import { ChatFaces } from '../people/ChatFaces.tsx';

/**
 * One chat in an agent's list (S5.1c; 2026-11-14 for its dot's column and its faces): a fixed column for its dot before
 * the title, the same width on every row so the titles line up (green and pulsing while a turn waits or runs, steady
 * with reduced motion; blue for activity not seen; empty otherwise); the title (a branch's after a small branch icon, a
 * flow's team chat after a bell); under it the faces of who the agent talks with there and when it last moved, which
 * goes under the faces when the row is too narrow; Archive for admins.
 */

const DOT_TONE: Readonly<Record<ChatDot, string>> = { working: 'bg-done', unseen: 'bg-blue' };

/** The dot's column: always there, empty without a dot. */
function DotColumn({ dot }: { readonly dot: ChatDot | undefined }) {
  if (dot === undefined) return <span aria-hidden="true" className="mt-1.5 size-2 shrink-0" />;
  const tone = DOT_TONE[dot];
  return (
    <span className="relative mt-1.5 flex size-2 shrink-0" role="img" aria-label={CHAT_DOT_WORDS[dot]}>
      {dot === 'working' && (
        <span className={cx('absolute inset-0 rounded-full opacity-0 motion-safe:animate-attention', tone)} />
      )}
      <span className={cx('relative size-full rounded-full', tone)} />
    </span>
  );
}

/** The title on one line, after its marks. */
function ChatTitle({ chat, open }: { readonly chat: ChatListItem; readonly open: boolean }) {
  return (
    <span
      className={cx('flex min-w-0 items-center gap-1 text-sm font-medium', open ? 'text-ink' : 'text-ink-2')}
    >
      {chat.flowId && <BellRing size={12} aria-label="Team chat" className="shrink-0 text-blue" />}
      {chat.branchedFromChatId && (
        <GitBranch size={12} aria-label="Branched" className="shrink-0 text-faint" />
      )}
      <span className="truncate">{chat.title ?? 'New chat'}</span>
    </span>
  );
}

/** When it last moved: its latest turn, else when it began. */
const movedAt = (chat: ChatListItem) =>
  chat.lastTurn
    ? (chat.lastTurn.endedAt ?? chat.lastTurn.startedAt ?? chat.lastTurn.createdAt)
    : chat.updatedAt;

/** The row's link: the dot's column, then the title over the faces and the time. */
function RowLink({
  chat,
  open,
  dot,
  href,
}: {
  readonly chat: ChatListItem;
  readonly open: boolean;
  readonly dot: ChatDot | undefined;
  readonly href: string;
}) {
  return (
    <Link
      to={href}
      aria-current={open ? 'page' : undefined}
      className="flex min-w-0 flex-1 gap-2 rounded-lg py-1.5 pr-2.5 pl-2 focus-visible:outline-2 focus-visible:outline-blue"
    >
      <DotColumn dot={dot} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <ChatTitle chat={chat} open={open} />
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <ChatFaces people={chat.people} />
          <span className="text-2xs text-faint">{fromNow(movedAt(chat))}</span>
        </span>
      </span>
    </Link>
  );
}

/** One chat in the list, with Archive for admins (asked first, in place). */
export function ChatRow({
  chat,
  open,
  dot,
  href,
  admin,
  onArchive,
}: {
  readonly chat: ChatListItem;
  readonly open: boolean;
  readonly dot: ChatDot | undefined;
  readonly href: string;
  readonly admin: boolean;
  readonly onArchive?: (() => void) | undefined;
}) {
  const [asking, setAsking] = useState(false);
  if (asking && onArchive) {
    return (
      <li className="grid gap-2 rounded-lg bg-surface-2 px-3 py-2">
        <p className="text-xs text-ink-2">
          Archive “{chat.title ?? 'New chat'}”? It leaves this list and takes no new message.
        </p>
        <div className="flex gap-2">
          <Button size="sm" tone="danger" onClick={onArchive}>
            Archive
          </Button>
          <Button size="sm" tone="quiet" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li
      className={cx(
        'group flex min-w-0 items-center gap-1 rounded-lg',
        open ? 'bg-surface-3' : 'hover:bg-surface-2',
      )}
    >
      <RowLink chat={chat} open={open} dot={dot} href={href} />
      {admin && onArchive && (
        <IconButton
          label="Archive this chat"
          icon={Archive}
          size="sm"
          onClick={() => setAsking(true)}
          className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        />
      )}
    </li>
  );
}
