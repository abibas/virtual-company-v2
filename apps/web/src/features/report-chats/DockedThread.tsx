import { useEffect, useMemo, useRef } from 'react';
import { chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import type { AgentPlacement } from '../../api/types.ts';
import { useEarlierConversations } from '../../api/use-chat-earlier.ts';
import { type ChatLive, useChatLive } from '../../api/use-chat-live.ts';
import { ErrorBlock, LoadingBlock } from '../../components/data/LoadState.tsx';
import type { AgentIconSubject } from '../../components/feed/AgentIcon.tsx';
import { Composer } from '../chats/Composer.tsx';
import { QueuedMessages } from '../chats/delivery/QueuedMessages.tsx';
import { chatMachine, fixOf } from '../chats/machine-context.ts';
import { asking, chatActions, closedWhy, queueActions, queueView } from '../chats/OpenChat.tsx';
import { chatRunsMenus } from '../chats/runs/chat-runs.tsx';
import { useThreadAuthors } from '../chats/thread/authors.ts';
import { ChatThread } from '../chats/thread/ChatThread.tsx';
import { ChatMachineContext } from '../chats/thread/status/MachineWait.tsx';
import { useMarkSeen } from './seen.ts';

/** Calls `onChange` when the chat's running turn changes (one starts or ends): the rail's dots read again. */
function useRunningChange(runningId: string | undefined, onChange: () => void) {
  const seen = useRef(runningId);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (seen.current !== runningId) latest.current();
    seen.current = runningId;
  }, [runningId]);
}

/** Before the chat's detail came: loading, or the failure with Retry. */
function Opening({ detail }: { readonly detail: ChatLive['detail'] }) {
  return (
    <div className="flex flex-1 flex-col justify-center p-3">
      {detail.error !== undefined ? (
        <ErrorBlock error={detail.error} onRetry={detail.reload} />
      ) : (
        <LoadingBlock label="Opening the chat…" />
      )}
    </div>
  );
}

/**
 * A chat in the right rail, live: the chat page's thread (the stream, tool calls, subagents, questions, copy) and its
 * composer (delivery while the agent works, Stop, the waiting messages, the Mode and Model menus with short labels),
 * narrow and without the context meter. Its
 * replies count as seen as they show (`useMarkSeen`).
 */
export function DockedThread({
  companyId,
  chatId,
  agentName,
  face,
  admin,
  placement,
  onChanged,
}: {
  readonly companyId: string;
  readonly chatId: string;
  readonly agentName: string;
  /** The agent's icon, beside its replies. */
  readonly face: AgentIconSubject;
  readonly admin: boolean;
  readonly placement: AgentPlacement | undefined;
  /** A message was sent, or a turn started or ended. */
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const live = useChatLive(companyId, chatId);
  const folds = useEarlierConversations(calls, chatId);
  const authors = useThreadAuthors(companyId, face);
  useMarkSeen(chatId, live.turns);
  useRunningChange(live.turns.find((turn) => turn.status === 'running')?.id, onChanged);
  const chat = live.chat;
  if (chat === undefined) return <Opening detail={live.detail} />;
  const actions = chatActions(calls, live, chat, onChanged);
  const view = queueView(live, chat);
  const closed = closedWhy(chat, admin, placement);
  return (
    <ChatMachineContext.Provider
      value={chatMachine(calls, live, chat, companyId, fixOf(closed, placement, actions.send))}
    >
      <ChatThread
        dense
        turns={view.thread}
        agentName={agentName}
        authors={authors}
        chatInit={live.detail.data?.init ?? undefined}
        answering={{ answer: actions.answer, closed }}
        history={{ live: live.earlier, folds }}
      />
      <Composer
        dense
        running={view.running !== undefined}
        choices={view.choices}
        disabled={closed}
        placeholder={asking(view.thread) ? 'Answer above, or write here' : `Message ${agentName}`}
        onSend={async (prompt, delivery, options) => {
          await actions.send(prompt, delivery, options);
          onChanged();
        }}
        onStop={actions.stop}
        queue={<QueuedMessages queue={view.queue} actions={queueActions(calls, live, chat, view.running)} />}
        runs={chatRunsMenus({ calls, live, chat, closed, dense: true })}
      />
    </ChatMachineContext.Provider>
  );
}
