import { Folder, ListChecks, MessageSquare, Server, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccessProfile, AgentDetail, AgentPlacement, Chat } from '../../../api/types.ts';
import type { StreamState } from '../../../api/use-chat-live.ts';
import { Link } from '../../../app/router.tsx';
import { AgentIcon } from '../../../components/feed/AgentIcon.tsx';
import { SegmentedControl, type SegmentOption } from '../../../components/forms/Segmented.tsx';
import type { Crumb } from '../../../components/layout/Breadcrumbs.tsx';
import { harnessLabel } from '../../../components/org/agent-labels.ts';
import { Badge } from '../../../components/ui/Badge.tsx';
import { ClaudeMark, OpenAIMark } from '../../../components/ui/ProviderLogo.tsx';
import { ChatBar, HEADER_CONTROL } from './ChatBar.tsx';
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

/** The task a task's conversation is for (T-19): its key and title, and its page. */
export interface ChatTaskLink {
  readonly key: string;
  readonly title: string;
  readonly href: string;
}

/** The way back to the task from its conversation: "T-18", with the task's title on hover. */
function TaskLink({ task }: { readonly task: ChatTaskLink }) {
  return (
    <Link to={task.href} title={`Open ${task.key} · ${task.title}`} className={HEADER_CONTROL}>
      <ListChecks size={13} aria-hidden="true" />
      {task.key}
    </Link>
  );
}

/**
 * The open chat's header (S5.1c), one row across the page: the path to its chats (Company structure › Agents › the
 * agent › Chats; the open chat is the one marked in the list), the harness, the machine and the folder under it; on the right the access profile picker,
 * the harness CLI on the machine (linking to its tools), "Open in Claude Code" for admins once the chat has a
 * conversation (S5.2 step 6), the Chat / Terminal switch (the terminal for owners only) and (2026-11-14) the ⋯ menu with
 * People in this chat; an owner who only looks on sees the "Owner view" mark. A task's conversation leads back to its
 * task first (T-19).
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
  badges,
  more,
  task,
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
  /** Marks after the facts (the owner view's, 2026-11-14). */
  readonly badges?: ReactNode;
  /** The last control: the ⋯ menu (People in this chat, 2026-11-14). */
  readonly more?: ReactNode;
  /** The task of a task's conversation (T-19), linked first among the controls. */
  readonly task?: ChatTaskLink | undefined;
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
      lead={<AgentIcon agent={agent} size="sm" />}
      facts={
        <>
          <h2 className="sr-only">{chat.title ?? `New chat with ${agent.name}`}</h2>
          <Badge size="sm" icon={chat.harness === 'codex' ? OpenAIMark : ClaudeMark} className="shrink-0">
            {harnessLabel(chat.harness)}
          </Badge>
          <WhereLine placement={placement} />
          {badges}
          {streamWords && (
            <Badge size="sm" tone={stream === 'gone' ? 'failed' : 'pending'} dot className="shrink-0">
              {streamWords}
            </Badge>
          )}
        </>
      }
      controls={
        <>
          {task && <TaskLink task={task} />}
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
          {more}
        </>
      }
    />
  );
}
