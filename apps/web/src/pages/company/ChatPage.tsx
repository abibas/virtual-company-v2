import { roleAtLeast } from '@mwc/shared/roles';
import { MessagesSquare } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { chatCalls, useAgentChats } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import { useAgentAt, useAgentPlacement } from '../../api/org.ts';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import type { AgentDetail, AgentPlacement } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { navigate, useLocation } from '../../app/router.tsx';
import { cx } from '../../components/cx.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Breadcrumbs, type Crumb } from '../../components/layout/Breadcrumbs.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { type AgentLinks, chatsPath, companyAgentLinks } from '../../features/agents/links.ts';
import { ChatList } from '../../features/chats/ChatList.tsx';
import { CHAT_AREA, ChatBar } from '../../features/chats/header/ChatBar.tsx';
import { OpenChat } from '../../features/chats/OpenChat.tsx';
import { useFillViewport } from '../../features/chats/use-fill-viewport.ts';

/**
 * How far above the window's bottom the frame ends on wide screens. The frame's negative bottom margin (`lg:-mb-6`)
 * takes back the rest of the shell's bottom padding (`md:pb-10`, 40px), so the page itself never scrolls.
 */
const BOTTOM_GAP = 16;

/** The path to an agent's chats: Company structure › Agents › the agent › Chats. */
function chatCrumbs(links: AgentLinks, agent: AgentDetail | undefined): readonly Crumb[] {
  const base: Crumb[] = [
    { label: 'Company structure', href: links.chart },
    { label: 'Agents', href: links.list },
  ];
  if (agent === undefined) return base;
  return [
    ...base,
    { label: agent.name, href: links.agent(agent) },
    { label: 'Chats', href: links.chats(agent) },
  ];
}

/** The page's one frame: the header across the top, the list and the open chat under it (`CHAT_AREA`), in Inter. */
const FRAME = cx(CHAT_AREA.frame, 'font-reading md:-mt-3 lg:-mb-6');

/** The chat list's place in the frame: half the window when stacked, the left column with a hairline from `lg`. */
const LIST = cx(
  CHAT_AREA.list,
  'flex max-h-[50dvh] min-h-0 flex-col border-b border-line p-3 lg:max-h-none lg:border-r lg:border-b-0',
);

/** Why a new chat cannot begin with this agent now, or undefined. */
function cannotStart(agent: AgentDetail, placement: AgentPlacement | undefined): string | undefined {
  if (agent.status === 'archived') return 'The agent is archived: restore it to chat with it.';
  if (placement === null) return 'Choose where the agent runs (on its page) before chatting with it.';
  if (placement?.mode === 'container') return 'Chats run on the machine, in a folder; containers come later.';
  return undefined;
}

/** The page once the agent is loaded: its chats on the left, the open one on the right. */
function ChatsOf({
  agent,
  openWanted,
}: {
  readonly agent: AgentDetail;
  readonly openWanted: string | undefined;
}) {
  const { membership } = useCompany();
  const { companyId, slug, role } = membership;
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const chats = useAgentChats(companyId, agent.id);
  const placement = useAgentPlacement(companyId, agent.id);
  const profiles = useAccessProfiles();
  const admin = roleAtLeast(role, 'admin');
  const openId = openWanted ?? chats.data?.chats[0]?.id;
  const hrefOf = (chatId?: string) => chatsPath(slug, agent.id, chatId);

  const newChat = async () => {
    const chat = await calls.create(agent.id);
    chats.reload();
    navigate(hrefOf(chat.id));
  };
  const archive = async (chatId: string) => {
    await calls.archive(chatId);
    chats.reload();
    if (chatId === openId) navigate(hrefOf(), { replace: true });
  };
  const list = { chats, openId, hrefOf, admin, onNew: newChat, onArchive: archive };
  const crumbs = chatCrumbs(companyAgentLinks(slug), agent);
  // On wide screens the frame fills the window to its bottom exactly, so only the thread and the list scroll.
  const frame = useRef<HTMLDivElement>(null);
  const height = useFillViewport(frame, BOTTOM_GAP);
  const fill = height === undefined ? undefined : { height };
  return (
    <Card ref={frame} padding="none" className={FRAME} style={fill}>
      <div className={LIST}>
        <ChatList {...list} cannotStart={cannotStart(agent, placement.data)} />
      </div>
      {openId ? (
        <OpenChat
          key={openId}
          crumbs={crumbs}
          companyId={companyId}
          chatId={openId}
          agent={agent}
          placement={placement.data}
          profiles={profiles.data?.profiles ?? (profiles.error === undefined ? undefined : [])}
          admin={admin}
          owner={roleAtLeast(role, 'owner')}
          onChanged={chats.reload}
        />
      ) : (
        <NoChatOpen crumbs={crumbs} name={agent.name} admin={admin} />
      )}
    </Card>
  );
}

/** The header's path and, in the right column, the invitation to start a chat, before any chat exists. */
function NoChatOpen({
  crumbs,
  name,
  admin,
}: {
  readonly crumbs: readonly Crumb[];
  readonly name: string;
  readonly admin: boolean;
}) {
  return (
    <>
      <ChatBar crumbs={crumbs} />
      <div className={cx(CHAT_AREA.body, 'flex min-h-[50dvh] flex-col')}>
        <EmptyState icon={MessagesSquare} tone="blue" title={`Chat with ${name}`} className="my-auto">
          {admin
            ? 'Start a new chat: it runs on the agent’s machine, in its folder, on its access profile or one of yours.'
            : 'No chats with this agent yet. Admins and owners start them.'}
        </EmptyState>
      </div>
    </>
  );
}

/**
 * `/:slug/chats/:agentId` (S5.1c): an agent's chats, newest first, and the open one (`?chat=<id>`, else the newest),
 * live, with its access profile picker and, for owners, its terminal, in one frame under one header with the path the
 * person came through. Members read; admins and owners write. The page reads in Inter (`font-reading`).
 */
export function ChatPage({ agentId }: { readonly agentId: string }) {
  const { membership } = useCompany();
  const { search } = useLocation();
  const agent = useAgentAt(membership.companyId, agentId);
  const links = companyAgentLinks(membership.slug);
  return (
    <>
      {agent.data === undefined && <Breadcrumbs items={chatCrumbs(links, undefined)} className="mb-3" />}
      <LoadState loaded={agent} label="Loading the agent…">
        {(data) => <ChatsOf agent={data} openWanted={search.get('chat') ?? undefined} />}
      </LoadState>
    </>
  );
}
