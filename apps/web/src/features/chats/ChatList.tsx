import { MessageSquarePlus, MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChatListItem } from '../../api/types.ts';
import type { AgentChatGroups } from '../../api/use-agent-chats-live.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import type { ChatDot } from './chat-dots.ts';
import { ChatRow } from './list/ChatRow.tsx';
import { useSteadyOrder } from './list/steady-order.ts';
import { TaskChats } from './list/TaskChats.tsx';
import { NewChatWith } from './people/NewChatWith.tsx';
import { useAction } from './use-action.ts';

export interface ChatListProps {
  /** The agent's chats and, apart, its task conversations (T-19). */
  readonly chats: Loaded<AgentChatGroups>;
  readonly openId: string | undefined;
  readonly hrefOf: (chatId: string) => string;
  /** Admins and owners begin and archive chats. */
  readonly admin: boolean;
  /** Why a new chat cannot begin (no placement, an archived agent), or undefined. */
  readonly cannotStart: string | undefined;
  /** A new chat, with the members it is with besides you (2026-11-14), if any. */
  readonly onNew: (people?: readonly string[]) => Promise<void>;
  readonly onArchive: (chatId: string) => Promise<void>;
  /** Each chat's dot (2026-11-13: live, from the chats' activity): working, or new activity since you looked. */
  readonly dots?: ReadonlyMap<string, ChatDot> | undefined;
  /** What goes under the list (an owner's "Other people's chats"). */
  readonly after?: ReactNode;
}

/** The chats, in their live order, held while the pointer is over them so a row does not jump away from it. */
function Rows({
  chats,
  openId,
  hrefOf,
  admin,
  dots,
  onArchive,
}: Pick<ChatListProps, 'openId' | 'hrefOf' | 'admin' | 'dots'> & {
  readonly chats: readonly ChatListItem[];
  readonly onArchive: (chatId: string) => void;
}) {
  const { shown, hold } = useSteadyOrder(chats);
  return (
    // One shrinkable column (`grid-cols-1`): a long title truncates in its row instead of widening the list, which
    // used to give it a sideways scrollbar.
    <ul
      {...hold}
      className="scroll-quiet -mx-1 grid min-h-0 grid-cols-1 content-start gap-0.5 overflow-x-hidden overflow-y-auto px-1"
    >
      {shown.map((chat) => (
        <ChatRow
          key={chat.id}
          chat={chat}
          open={chat.id === openId}
          dot={dots?.get(chat.id)}
          href={hrefOf(chat.id)}
          admin={admin}
          onArchive={() => onArchive(chat.id)}
        />
      ))}
    </ul>
  );
}

/**
 * The left column (S5.1c): the agent's chats you are in (2026-11-14: each with the faces of who the agent talks with
 * there), the live ones first, then the latest; with New chat (alone, or With people) and Archive (admins and owners);
 * live since 2026-11-13 (a new chat in place at once, each with its dot). Under them, apart, its task conversations
 * (T-19, "Tasks"), live the same way.
 */
export function ChatList({
  chats,
  openId,
  hrefOf,
  admin,
  cannotStart,
  onNew,
  onArchive,
  dots,
  after,
}: ChatListProps) {
  const { busy, error, run } = useAction();
  return (
    <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col gap-3">
      {admin && (
        <>
          <div className="flex items-center gap-1.5">
            <Button
              tone="primary"
              size="sm"
              icon={MessageSquarePlus}
              busy={busy}
              disabled={cannotStart !== undefined}
              onClick={() => void run(() => onNew())}
              className="min-w-0 flex-1"
            >
              New chat
            </Button>
            <NewChatWith disabled={cannotStart !== undefined} onStart={onNew} />
          </div>
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
            <Rows
              chats={data.chats}
              openId={openId}
              hrefOf={hrefOf}
              admin={admin}
              dots={dots}
              onArchive={(chatId) => void run(() => onArchive(chatId))}
            />
          )
        }
      </LoadState>
      {chats.data && <TaskChats chats={chats.data.tasks} openId={openId} hrefOf={hrefOf} dots={dots} />}
      {after}
    </nav>
  );
}
