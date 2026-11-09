import { lazy, Suspense, useMemo } from 'react';
import { chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import type { Chat } from '../../api/types.ts';
import { LoadingBlock } from '../../components/data/LoadState.tsx';
import { harnessLabel } from '../../components/org/agent-labels.ts';
import { refusalText } from './chat-text.ts';

/** xterm.js loads only when the terminal opens. */
const TerminalPanel = lazy(() =>
  import('../machines/terminal/TerminalPanel.tsx').then((module) => ({ default: module.TerminalPanel })),
);

/**
 * The chat's terminal mode (S5.1c, owners only): the machine terminal's panel in the page, its ticket from
 * `POST …/chats/{chatId}/terminal-tickets`, so the socket opens the harness's own TUI on this chat's conversation in
 * the agent's folder. Leaving terminal mode closes the socket, which ends the TUI.
 */
export function ChatTerminal({ companyId, chat }: { readonly companyId: string; readonly chat: Chat }) {
  const api = useApi();
  const getTicket = useMemo(() => {
    const calls = chatCalls(api, companyId);
    return () => calls.terminalTicket(chat.id);
  }, [api, companyId, chat.id]);
  const harness = harnessLabel(chat.harness);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3 md:px-5">
      <p className="text-xs text-dim">
        {chat.sessionId
          ? `The real ${harness} on this chat's conversation, in the agent's folder. Typing here spends the chat's subscription.`
          : `${harness} in the agent's folder. This chat has no conversation yet: send a first message to have the terminal resume it.`}
      </p>
      <Suspense fallback={<LoadingBlock label="Opening the terminal…" />}>
        <TerminalPanel getTicket={getTicket} describeError={refusalText} className="min-h-0 flex-1" />
      </Suspense>
    </div>
  );
}
