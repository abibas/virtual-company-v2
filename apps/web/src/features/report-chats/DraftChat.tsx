import { MessagesSquare } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import type { AgentPlacement } from '../../api/types.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Composer } from '../chats/Composer.tsx';

/** Why a new chat cannot begin from the rail now, or undefined (the chat page's own reasons). */
export function draftClosedWhy(admin: boolean, placement: AgentPlacement | undefined): string | undefined {
  if (!admin) return 'Admins and owners start chats with agents.';
  if (placement === null)
    return "The agent doesn't run anywhere now: choose where it runs on its page first.";
  if (placement?.mode === 'container') return 'Chats run on the machine, in a folder; containers come later.';
  return undefined;
}

const nothingToStop = async () => undefined;

/**
 * No chat with the agent yet, or New chat: the first message begins a chat (on the agent's harness, machine and access
 * profile, as the chat page's New chat does) and is sent in it; then the rail shows that chat. A send that fails after
 * the chat began reuses that chat on the next try.
 */
export function DraftChat({
  companyId,
  agentId,
  agentName,
  admin,
  placement,
  onCreated,
}: {
  readonly companyId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly admin: boolean;
  readonly placement: AgentPlacement | undefined;
  readonly onCreated: (chatId: string) => void;
}) {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const begun = useRef<string>(undefined);
  const send = async (prompt: string) => {
    begun.current ??= (await calls.create(agentId)).id;
    await calls.send(begun.current, prompt);
    onCreated(begun.current);
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-3 py-4">
        <EmptyState icon={MessagesSquare} tone="blue" size="sm" title={`Chat with ${agentName}`}>
          Your first message starts a new chat. It runs on the agent’s machine, in its folder, with its own
          tools.
        </EmptyState>
      </div>
      <Composer
        dense
        running={false}
        choices={undefined}
        disabled={draftClosedWhy(admin, placement)}
        placeholder={`Message ${agentName}`}
        onSend={send}
        onStop={nothingToStop}
      />
    </>
  );
}
