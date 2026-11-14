import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { useState } from 'react';
import type { ChatCalls } from '../../../api/chats.ts';
import type { ChatListItem } from '../../../api/types.ts';
import { ChatRow } from '../list/ChatRow.tsx';
import { useAction } from '../use-action.ts';

/**
 * "Other people's chats" (2026-11-14, docs/harness.md "Who is in a chat"), for company owners only: under the agent's
 * own chats, the ones the owner is not in, read when opened (not live), each opening read-only (the owner view, where
 * Add me puts them in).
 */
export function OthersChats({
  calls,
  agentId,
  openId,
  hrefOf,
}: {
  readonly calls: ChatCalls;
  readonly agentId: string;
  readonly openId: string | undefined;
  readonly hrefOf: (chatId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<readonly ChatListItem[]>();
  const { busy, error, run } = useAction();
  const toggle = () => {
    setOpen(!open);
    if (!open) void run(async () => setChats((await calls.others(agentId)).chats));
  };
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label="Other people's chats" className="grid gap-1 border-t border-line pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-semibold text-dim hover:text-ink"
      >
        <Chevron size={14} aria-hidden="true" />
        <Eye size={13} aria-hidden="true" />
        Other people's chats
        {chats && <span className="font-normal text-faint">{chats.length}</span>}
      </button>
      {open && error && <p className="px-1 text-xs text-failed">{error}</p>}
      {open && busy && chats === undefined && <p className="px-1 text-xs text-faint">Loading…</p>}
      {open && chats?.length === 0 && (
        <p className="px-1 text-xs text-faint">None: every chat has you in it.</p>
      )}
      {open && chats && chats.length > 0 && (
        <ul className="scroll-quiet grid max-h-56 grid-cols-1 content-start gap-0.5 overflow-y-auto">
          {chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              open={chat.id === openId}
              dot={undefined}
              href={hrefOf(chat.id)}
              admin={false}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
