import { Folder, MessageSquare, Server, SquareTerminal } from 'lucide-react';
import type { AccessProfile, AgentDetail, AgentPlacement, Chat } from '../../../api/types.ts';
import type { StreamState } from '../../../api/use-chat-live.ts';
import { SegmentedControl, type SegmentOption } from '../../../components/forms/Segmented.tsx';
import type { Crumb } from '../../../components/layout/Breadcrumbs.tsx';
import { harnessLabel } from '../../../components/org/agent-labels.ts';
import { AgentAvatar } from '../../../components/org/OrgNodeCard.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { ClaudeMark, OpenAIMark } from '../../../components/ui/ProviderLogo.tsx';
import { ChatBar } from './ChatBar.tsx';
import { HarnessChip } from './HarnessChip.tsx';
import { OpenInClaudeCode } from './OpenInClaudeCode.tsx';
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
        <span className="truncate">{placement.home}</span>
      </span>
    </>
  );
}

/**
 * The open chat's header (S5.1c), one row across the page: the path to its chats (Company structure › Agents › the
 * agent › Chats; the open chat is the one marked in the list), the harness, the machine and the folder under it; on the right the access profile picker,
 * the harness CLI on the machine (linking to its tools), "Open in Claude Code" for admins once the chat has a
 * conversation (S5.2 step 6) and the Chat / Terminal switch (the terminal for owners only).
 */
export function ChatHeader({
  crumbs,
  companyId,
  sessionCwd,
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
  /** The path to the agent's chats. */
  readonly crumbs: readonly Crumb[];
  readonly companyId: string;
  /** The folder the conversation began in (its last `init`'s), for "Open in Claude Code". */
  readonly sessionCwd: string | undefined;
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
    <ChatBar
      crumbs={crumbs}
      lead={<AgentAvatar agent={agent} size="sm" />}
      facts={
        <>
          <h2 className="sr-only">{chat.title ?? `New chat with ${agent.name}`}</h2>
          <Badge size="sm" icon={chat.harness === 'codex' ? OpenAIMark : ClaudeMark} className="shrink-0">
            {harnessLabel(chat.harness)}
          </Badge>
          <WhereLine placement={placement} />
          {streamWords && (
            <Badge size="sm" tone={stream === 'gone' ? 'failed' : 'pending'} dot className="shrink-0">
              {streamWords}
            </Badge>
          )}
        </>
      }
      controls={
        <>
          <ProfilePicker
            chat={chat}
            agentProfileName={agent.profile?.name ?? null}
            profiles={profiles}
            canChange={admin}
            onChange={onProfile}
          />
          <HarnessChip companyId={companyId} machineId={chat.machineId} harness={chat.harness} />
          {admin && (
            <OpenInClaudeCode
              companyId={companyId}
              chat={chat}
              placement={placement}
              sessionCwd={sessionCwd}
            />
          )}
          <SegmentedControl
            options={modes}
            value={mode}
            onChange={onMode}
            label="Chat or terminal"
            size="sm"
            className="bg-surface-2! p-0.5!"
          />
        </>
      }
    />
  );
}
