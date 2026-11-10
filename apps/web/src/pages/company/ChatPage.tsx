import { roleAtLeast } from '@mwc/shared/roles';
import { ArrowLeft, MessagesSquare } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { chatCalls, useAgentChats } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import { useAgentAt, useAgentPlacement } from '../../api/org.ts';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import type { AgentDetail, AgentPlacement } from '../../api/types.ts';
import { useCompany } from '../../app/company.ts';
import { navigate, useLocation } from '../../app/router.tsx';
import { LoadState } from '../../components/data/LoadState.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { chatsPath, companyAgentLinks } from '../../features/agents/links.ts';
import { ChatList } from '../../features/chats/ChatList.tsx';
import { OpenChat } from '../../features/chats/OpenChat.tsx';
import { useFillViewport } from '../../features/chats/use-fill-viewport.ts';

/** The shell's bottom padding on wide screens (`md:pb-10`): the columns end that far above the window's bottom. */
const BOTTOM_GAP = 40;

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
  // On wide screens the two columns fill the window to its bottom exactly, so only the thread and the list scroll.
  const columns = useRef<HTMLDivElement>(null);
  const height = useFillViewport(columns, BOTTOM_GAP);
  const fill = height === undefined ? undefined : { height };
  return (
    <div ref={columns} className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]" style={fill}>
      <Card padding="sm" className="flex max-h-[50dvh] min-h-0 flex-col lg:max-h-none">
        <ChatList {...list} cannotStart={cannotStart(agent, placement.data)} />
      </Card>
      <Card padding="none" className="flex h-[80dvh] min-h-0 flex-col lg:h-auto">
        {openId ? (
          <OpenChat
            key={openId}
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
          <NoChatOpen name={agent.name} admin={admin} />
        )}
      </Card>
    </div>
  );
}

/** The right column before any chat exists. */
function NoChatOpen({ name, admin }: { readonly name: string; readonly admin: boolean }) {
  return (
    <EmptyState icon={MessagesSquare} tone="blue" title={`Chat with ${name}`} className="my-auto">
      {admin
        ? 'Start a new chat: it runs on the agent’s machine, in its folder, on its access profile or one of yours.'
        : 'No chats with this agent yet. Admins and owners start them.'}
    </EmptyState>
  );
}

/**
 * `/:slug/chats/:agentId` (S5.1c): an agent's chats, newest first, and the open one (`?chat=<id>`, else the newest),
 * live, with its access profile picker and, for owners, its terminal. Members read; admins and owners write.
 */
export function ChatPage({ agentId }: { readonly agentId: string }) {
  const { membership } = useCompany();
  const { search } = useLocation();
  const agent = useAgentAt(membership.companyId, agentId);
  const links = companyAgentLinks(membership.slug);
  return (
    <>
      <ButtonLink
        href={agent.data ? links.agent(agent.data) : links.list}
        tone="quiet"
        size="sm"
        icon={ArrowLeft}
        className="mb-3 -ml-2"
      >
        {agent.data?.name ?? 'Agents'}
      </ButtonLink>
      <LoadState loaded={agent} label="Loading the agent…">
        {(data) => <ChatsOf agent={data} openWanted={search.get('chat') ?? undefined} />}
      </LoadState>
    </>
  );
}
