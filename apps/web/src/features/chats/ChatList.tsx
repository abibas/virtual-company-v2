import { Archive, GitBranch, MessageSquarePlus, MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import type { Chat } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { Link } from '../../app/router.tsx';
import { cx } from '../../components/cx.ts';
import { fromNow } from '../../components/data/format.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { IconButton } from '../../components/ui/IconButton.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import { useAction } from './use-action.ts';

export interface ChatListProps {
  readonly chats: Loaded<{ readonly chats: readonly Chat[] }>;
  readonly openId: string | undefined;
  readonly hrefOf: (chatId: string) => string;
  /** Admins and owners begin and archive chats. */
  readonly admin: boolean;
  /** Why a new chat cannot begin (no placement, an archived agent), or undefined. */
  readonly cannotStart: string | undefined;
  readonly onNew: () => Promise<void>;
  readonly onArchive: (chatId: string) => Promise<void>;
}

/** A chat's title in the list, a branch's after a small branch icon. */
function ChatTitle({ chat, open }: { readonly chat: Chat; readonly open: boolean }) {
  return (
    <span
      className={cx('flex min-w-0 items-center gap-1 text-sm font-medium', open ? 'text-ink' : 'text-ink-2')}
    >
      {chat.branchedFromChatId && (
        <GitBranch size={12} aria-label="Branched" className="shrink-0 text-faint" />
      )}
      <span className="truncate">{chat.title ?? 'New chat'}</span>
    </span>
  );
}

/** One chat in the list: its title (a branch's with a small branch icon) and when it last changed, with Archive for admins. */
function ChatRow({
  chat,
  open,
  href,
  admin,
  onArchive,
}: {
  readonly chat: Chat;
  readonly open: boolean;
  readonly href: string;
  readonly admin: boolean;
  readonly onArchive: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
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
      <Link
        to={href}
        aria-current={open ? 'page' : undefined}
        className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-blue"
      >
        <ChatTitle chat={chat} open={open} />
        <span className="block text-2xs text-faint">{fromNow(chat.updatedAt)}</span>
      </Link>
      {admin && (
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

/** The left column (S5.1c): the agent's chats, newest first, with New chat and Archive (admins and owners). */
export function ChatList({ chats, openId, hrefOf, admin, cannotStart, onNew, onArchive }: ChatListProps) {
  const { busy, error, run } = useAction();
  return (
    <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col gap-3">
      {admin && (
        <>
          <Button
            tone="primary"
            size="sm"
            icon={MessageSquarePlus}
            busy={busy}
            disabled={cannotStart !== undefined}
            onClick={() => void run(onNew)}
            className="w-full"
          >
            New chat
          </Button>
          {cannotStart && <p className="text-xs text-dim">{cannotStart}</p>}
        </>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      <LoadState loaded={chats} label="Loading the chats…" skeleton={<SkeletonRows />}>
        {(data) =>
          data.chats.length === 0 ? (
            <EmptyState icon={MessagesSquare} tone="blue" title="No chats yet" size="sm">
              {admin ? 'Start one to talk with the agent on its machine.' : 'Admins and owners start chats.'}
            </EmptyState>
          ) : (
            // One shrinkable column (`grid-cols-1`): a long title truncates in its row instead of widening the
            // list, which used to give it a sideways scrollbar.
            <ul className="scroll-quiet -mx-1 grid min-h-0 grid-cols-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-1">
              {data.chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  open={chat.id === openId}
                  href={hrefOf(chat.id)}
                  admin={admin}
                  onArchive={() => void run(() => onArchive(chat.id))}
                />
              ))}
            </ul>
          )
        }
      </LoadState>
    </nav>
  );
}
