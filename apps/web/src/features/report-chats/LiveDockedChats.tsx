import { useAgentPlacement } from '../../api/org.ts';
import { chatsPath } from '../agents/links.ts';
import { companyFlowLinks } from '../flows/links.ts';
import { LiveRoom } from '../room/LiveRoom.tsx';
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

/** Which chat of the open report the rail shows: the one it opened itself, or its main chat (the team mode shows the room). */
export function dockedChatId(
  report: RailReport['report'],
  override: DockOverride | undefined,
): string | undefined {
  const own = override?.agentId === report.agent.id ? override.chatId : report.chat?.id;
  return own === DRAFT ? undefined : own;
}

/**
 * The Chats view, live: the open report's chat (its main chat with you, or a new one on the first message) in the docked
 * frame, with its placement (why a message cannot go) and its full chat page's address; for a Lead in Team chat, its
 * flow's team room, with the team page's Team chat as its full page.
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
  const team = mode === 'team' ? selected.report.team : null;
  if (team !== null)
    return (
      <DockedChats
        reports={reports}
        selected={selected}
        onPick={onPick}
        mode={mode}
        onMode={onMode}
        fullHref={companyFlowLinks(slug).team(agent.slug, 'chat')}
        body={<LiveRoom key={team.flowId} flowId={team.flowId} dense faces />}
      />
    );
  const chatId = dockedChatId(selected.report, override);
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
  if (chatId)
    body = (
      <DockedThread key={chatId} {...thread} face={selected.face} chatId={chatId} onChanged={onChanged} />
    );
  return (
    <DockedChats
      reports={reports}
      selected={selected}
      onPick={onPick}
      mode={mode}
      onMode={onMode}
      fullHref={chatsPath(slug, agent.id, chatId)}
      onNew={admin ? () => onOverride({ agentId: agent.id, chatId: DRAFT }) : undefined}
      body={body}
    />
  );
}
