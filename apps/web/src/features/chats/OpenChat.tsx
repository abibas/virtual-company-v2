import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isLiveTurn } from '../../api/chat-turns.ts';
import { type ChatCalls, chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import type { AccessProfile, AgentDetail, AgentPlacement, Chat } from '../../api/types.ts';
import { type ChatLive, useChatLive } from '../../api/use-chat-live.ts';
import { ErrorBlock, LoadingBlock } from '../../components/data/LoadState.tsx';
import { ChatHeader, type ChatMode } from './ChatHeader.tsx';
import { ChatTerminal } from './ChatTerminal.tsx';
import { Composer } from './Composer.tsx';
import { ChatContextMeter } from './context/ChatContextMeter.tsx';
import { ChatThread } from './thread/ChatThread.tsx';

export interface OpenChatProps {
  readonly companyId: string;
  readonly chatId: string;
  readonly agent: AgentDetail;
  readonly placement: AgentPlacement | undefined;
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly admin: boolean;
  readonly owner: boolean;
  /** The chat changed in a way the list shows (its title after the first prompt, its profile). */
  readonly onChanged: () => void;
}

/** Why the composer is closed: an archived chat, a reader who is not an admin, an agent placed nowhere now. */
function closedWhy(chat: Chat, admin: boolean, placement: AgentPlacement | undefined): string | undefined {
  if (chat.archivedAt) return 'This chat is archived: it stays readable, and takes no new message.';
  if (!admin) return 'Admins and owners send messages to agents; you can read this chat.';
  if (placement === null)
    return "The agent doesn't run anywhere now: choose where it runs on its page first.";
  return undefined;
}

/** The agent moved to another machine since the chat began: its conversation is not there. */
function MovedNotice() {
  return (
    <p className="flex items-center gap-2 bg-input-soft px-4 py-2 text-xs text-ink md:px-5">
      <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-input" />
      The agent runs on another machine now, so this chat's conversation isn't there: start a new chat.
    </p>
  );
}

/** Send, Stop and a profile change, each shown at once from the API's answer. */
function chatActions(calls: ChatCalls, live: ChatLive, chat: Chat, onChanged: () => void) {
  const running = live.turns.find(isLiveTurn);
  const first = live.turns.length === 0;
  return {
    running,
    send: async (prompt: string) => {
      live.putTurn(await calls.send(chat.id, prompt));
      if (first) onChanged();
    },
    stop: async () => {
      if (running) live.putTurn(await calls.stop(chat.id, running.id));
    },
    changeProfile: async (profileId: string | null) => {
      live.putChat(await calls.update(chat.id, { profileId }));
      onChanged();
    },
  };
}

/**
 * The open chat (S5.1c): its header, then the live thread with the composer, or the terminal. The chat and its turns
 * come from `useChatLive` (the detail, then the stream); a prompt, a stop and a profile change show their answer at
 * once, before the stream says the same.
 */
export function OpenChat({ companyId, chatId, agent, placement, admin, owner, ...rest }: OpenChatProps) {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const live = useChatLive(companyId, chatId);
  const [mode, setMode] = useState<ChatMode>('chat');
  const chat = live.chat;
  if (chat === undefined) {
    const { error, reload } = live.detail;
    if (error !== undefined) return <ErrorBlock error={error} onRetry={reload} />;
    return <LoadingBlock label="Opening the chat…" />;
  }
  const actions = chatActions(calls, live, chat, rest.onChanged);
  const header = { agent, placement, chat, admin, owner, mode, profiles: rest.profiles };
  const closed = closedWhy(chat, admin, placement);
  return (
    <>
      <ChatHeader {...header} stream={live.stream} onMode={setMode} onProfile={actions.changeProfile} />
      {placement && placement.machineId !== chat.machineId && <MovedNotice />}
      {mode === 'terminal' && owner ? (
        <ChatTerminal companyId={companyId} chat={chat} />
      ) : (
        <>
          <ChatThread turns={live.turns} agentName={agent.name} />
          <Composer
            running={actions.running !== undefined}
            disabled={closed}
            placeholder={`Message ${agent.name}`}
            onSend={actions.send}
            onStop={actions.stop}
            meter={<ChatContextMeter calls={calls} live={live} chat={chat} closed={closed} />}
          />
        </>
      )}
    </>
  );
}
