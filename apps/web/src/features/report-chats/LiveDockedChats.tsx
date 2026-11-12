import { Users } from 'lucide-react';
import { useAgentPlacement } from '../../api/org.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { chatsPath } from '../agents/links.ts';
import { DockedChats, type DockMode } from './DockedChats.tsx';
import { DockedThread } from './DockedThread.tsx';
import { DraftChat } from './DraftChat.tsx';
import type { RailReport } from './standing.ts';

/** A chat the rail opened itself (one begun from it, or New chat's draft), until the list says the same. */
export interface DockOverride {
  readonly agentId: string;
  /** The chat begun, or `draft`: the next message begins one. */
  readonly chatId: string;
}

export const DRAFT = 'draft';

/** Which chat of the open report the rail shows: the team chat, the one it opened itself, or its main chat. */
export function dockedChatId(
  report: RailReport['report'],
  mode: DockMode,
  override: DockOverride | undefined,
): string | undefined {
  if (mode === 'team') return report.team?.chatId ?? undefined;
  const own = override?.agentId === report.agent.id ? override.chatId : report.chat?.id;
  return own === DRAFT ? undefined : own;
}

/**
 * The Chats view, live: the open report's chat (its main chat with you, its team chat for a Lead, or a new one on the
 * first message) in the docked frame, with its placement (why a message cannot go) and its full chat page's address.
 */
export function LiveDockedChats({
  companyId,
  slug,
  admin,
  reports,
  selected,
  onPick,
  mode,
  onMode,
  override,
  onOverride,
  onChanged,
}: {
  readonly companyId: string;
  readonly slug: string;
  readonly admin: boolean;
  readonly reports: readonly RailReport[];
  readonly selected: RailReport | undefined;
  readonly onPick: (agentId: string) => void;
  readonly mode: DockMode;
  readonly onMode: (mode: DockMode) => void;
  readonly override: DockOverride | undefined;
  readonly onOverride: (override: DockOverride) => void;
  readonly onChanged: () => void;
}) {
  const agent = selected?.report.agent;
  const placement = useAgentPlacement(companyId, agent?.id).data;
  if (selected === undefined || agent === undefined)
    return (
      <DockedChats
        reports={[]}
        selected={undefined}
        {...{ onPick, mode, onMode }}
        fullHref={undefined}
        body={null}
      />
    );
  const chatId = dockedChatId(selected.report, mode, override);
  const thread = { companyId, agentName: agent.name, admin, placement };
  let body = (
    <DraftChat
      key={agent.id}
      {...thread}
      agentId={agent.id}
      onCreated={(id) => {
        onOverride({ agentId: agent.id, chatId: id });
        onChanged();
      }}
    />
  );
  if (chatId) body = <DockedThread key={chatId} {...thread} chatId={chatId} onChanged={onChanged} />;
  else if (mode === 'team')
    body = (
      <div className="flex flex-1 flex-col justify-center p-3">
        <EmptyState icon={Users} size="sm" title="No team chat yet">
          Most Wanted starts it the first time the team’s events wake {agent.name}.
        </EmptyState>
      </div>
    );
  return (
    <DockedChats
      reports={reports}
      selected={selected}
      onPick={onPick}
      mode={mode}
      onMode={onMode}
      fullHref={chatId ? chatsPath(slug, agent.id, chatId) : undefined}
      onNew={admin ? () => onOverride({ agentId: agent.id, chatId: DRAFT }) : undefined}
      body={body}
    />
  );
}
