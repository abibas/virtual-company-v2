import { contextWindowOf } from '@mwc/shared/harness';
import { useMemo, useState } from 'react';
import { isLiveTurn } from '../../../api/chat-turns.ts';
import type { ChatCalls } from '../../../api/chats.ts';
import type { Chat } from '../../../api/types.ts';
import type { ChatLive } from '../../../api/use-chat-live.ts';
import { ContextMeter } from './ContextMeter.tsx';
import type { ConversationControls } from './ConversationActions.tsx';
import { type ConversationView, conversationView } from './context-state.ts';
import { conversationRefusal } from './context-text.ts';

const WAIT_FOR_TURN = 'Wait for the current turn to finish.';

/** Why Compact and Clear can't run now, in plain words; undefined when they can. */
function blockedWhy(view: ConversationView, running: boolean, closed: string | undefined) {
  const base = closed ?? (running ? WAIT_FOR_TURN : undefined);
  return {
    compact:
      base ?? (view.hasConversation ? undefined : "There's nothing to compact yet: send a message first."),
    clear:
      base ?? (view.hasConversation ? undefined : 'Nothing to clear yet: this chat has no conversation.'),
  };
}

/** Compact and Clear on the chat's routes, each answer put in the thread at once, refusals kept in plain words. */
function useControls(
  calls: ChatCalls,
  live: ChatLive,
  chat: Chat,
  blocked: ReturnType<typeof blockedWhy>,
): ConversationControls {
  const [busy, setBusy] = useState<'compact' | 'clear'>();
  const [error, setError] = useState<string>();
  const run = async (which: 'compact' | 'clear') => {
    setBusy(which);
    setError(undefined);
    try {
      live.putTurn(await (which === 'compact' ? calls.compact(chat.id) : calls.clear(chat.id)));
      return true;
    } catch (failure) {
      setError(conversationRefusal(failure));
      return false;
    } finally {
      setBusy(undefined);
    }
  };
  return {
    canCompact: chat.harness === 'claude_code',
    compactBlocked: blocked.compact,
    clearBlocked: blocked.clear,
    busy,
    error,
    compact: () => void run('compact'),
    clear: () => run('clear'),
  };
}

/**
 * The context meter of an open chat (S5.2), placed by its composer: how full the conversation is from the live turns
 * (else the detail's reading), with Compact and Clear, closed with the composer's reason when the chat takes no message.
 */
export function ChatContextMeter({
  calls,
  live,
  chat,
  closed,
  agentModel,
}: {
  readonly calls: ChatCalls;
  readonly live: ChatLive;
  readonly chat: Chat;
  /** Why the chat takes no message now (archived, not an admin, placed nowhere). */
  readonly closed: string | undefined;
  /** The agent's model: before the first reading, its window frames an empty meter ("Context 0 / 1M · 0%"). */
  readonly agentModel?: string;
}) {
  const { turns } = live;
  const detail = live.detail.data;
  const view = useMemo(() => {
    const read = conversationView(turns, detail);
    if (read.used !== undefined) return read;
    const model = read.model ?? agentModel ?? null;
    const window = read.window ?? contextWindowOf(model);
    return { ...read, model, window, used: 0, percent: window ? 0 : undefined };
  }, [turns, detail, agentModel]);
  const running = turns.some(isLiveTurn);
  const controls = useControls(calls, live, chat, blockedWhy(view, running, closed));
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ContextMeter view={view} controls={controls} />
      {controls.error && (
        <p role="alert" title={controls.error} className="min-w-0 truncate text-2xs font-medium text-failed">
          {controls.error}
        </p>
      )}
    </div>
  );
}
