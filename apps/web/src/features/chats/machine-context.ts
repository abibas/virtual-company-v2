import type { ChatCalls } from '../../api/chats.ts';
import type { AgentPlacement, Chat } from '../../api/types.ts';
import type { ChatLive } from '../../api/use-chat-live.ts';
import type { ChatMachine } from './thread/status/chat-machine.ts';

/** The open chat's machine context (`ChatMachineContext`), as the chat page and the rail's chat build it. */

/**
 * The chat's machine for the line of a turn waiting for it, whose Cancel stops that turn; for an admin with the agent
 * still on it, its home folder and Send again, offered when a turn found the folder missing.
 */
export function chatMachine(
  calls: ChatCalls,
  live: ChatLive,
  chat: Chat,
  companyId: string,
  fix?: { readonly placement: AgentPlacement | undefined; readonly send: (prompt: string) => Promise<void> },
): ChatMachine {
  const placement = fix?.placement;
  return {
    companyId,
    machineId: chat.machineId,
    cancel: async (turnId) => live.putTurn(await calls.stop(chat.id, turnId)),
    home:
      fix && placement && placement.machineId === chat.machineId
        ? { path: placement.home, resend: fix.send }
        : undefined,
  };
}

/** What fixes a missing home folder from the thread: only while the composer is open (an admin, a live chat). */
export function fixOf(
  closed: string | undefined,
  placement: AgentPlacement | undefined,
  send: (prompt: string, delivery: undefined) => Promise<void>,
) {
  return closed === undefined ? { placement, send: (prompt: string) => send(prompt, undefined) } : undefined;
}
