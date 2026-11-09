import { Folder, MessageSquare, Server, SquareTerminal } from 'lucide-react';
import type { AccessProfile, AgentDetail, AgentPlacement, Chat } from '../../api/types.ts';
import type { StreamState } from '../../api/use-chat-live.ts';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { harnessLabel } from '../../components/org/agent-labels.ts';
import { AgentAvatar } from '../../components/org/OrgNodeCard.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { ProfilePicker } from './ProfilePicker.tsx';

export type ChatMode = 'chat' | 'terminal';

const STREAM_WORDS: Readonly<Record<StreamState, string | undefined>> = {
  connecting: 'Connecting…',
  live: undefined,
  reconnecting: 'Reconnecting…',
  gone: 'This chat is gone',
};

/** Where the agent runs: its machine (with its status) and its folder, from its placement. */
function WhereLine({ placement }: { readonly placement: AgentPlacement | undefined }) {
  if (placement === undefined) return <span className="text-faint">Loading where it runs…</span>;
  if (placement === null) return <span className="text-input">Not placed on a machine</span>;
  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Server size={12} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{placement.machineName}</span>
        {placement.machineStatus !== 'online' && (
          <span className="text-input">({placement.machineStatus})</span>
        )}
      </span>
      <span className="inline-flex min-w-0 items-center gap-1" title={placement.home}>
        <Folder size={12} aria-hidden="true" className="shrink-0" />
        <span className="truncate font-mono">{placement.home}</span>
      </span>
    </>
  );
}

/**
 * The open chat's header (S5.1c): the agent, where it runs, the harness, the access profile picker and the Chat /
 * Terminal switch (the terminal for owners only).
 */
export function ChatHeader({
  agent,
  placement,
  chat,
  profiles,
  admin,
  owner,
  mode,
  stream,
  onMode,
  onProfile,
}: {
  readonly agent: AgentDetail;
  readonly placement: AgentPlacement | undefined;
  readonly chat: Chat;
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly admin: boolean;
  readonly owner: boolean;
  readonly mode: ChatMode;
  readonly stream: StreamState;
  readonly onMode: (mode: ChatMode) => void;
  readonly onProfile: (profileId: string | null) => Promise<void>;
}) {
  const modes: readonly SegmentOption<ChatMode>[] = [
    { value: 'chat', label: 'Chat', icon: MessageSquare },
    {
      value: 'terminal',
      label: 'Terminal',
      icon: SquareTerminal,
      disabled: !owner,
      ...(owner ? {} : { note: 'owners' }),
    },
  ];
  const streamWords = mode === 'chat' ? STREAM_WORDS[stream] : undefined;
  return (
    <header className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 md:px-5">
      <AgentAvatar agent={agent} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-md font-bold text-ink">
            {chat.title ?? `New chat with ${agent.name}`}
          </h3>
          <Badge size="sm">{harnessLabel(chat.harness)}</Badge>
          {streamWords && (
            <Badge size="sm" tone={stream === 'gone' ? 'failed' : 'pending'} dot>
              {streamWords}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-dim">
          <span className="font-semibold text-ink-2">{agent.name}</span>
          <WhereLine placement={placement} />
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <ProfilePicker
          chat={chat}
          agentProfileName={agent.profile?.name ?? null}
          profiles={profiles}
          canChange={admin}
          onChange={onProfile}
        />
        <SegmentedControl options={modes} value={mode} onChange={onMode} label="Chat or terminal" size="sm" />
      </div>
    </header>
  );
}
