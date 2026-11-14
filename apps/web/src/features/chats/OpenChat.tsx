import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type ChatCalls, chatCalls } from '../../api/chats.ts';
import { useApi } from '../../api/context.ts';
import type { AccessProfile, AgentDetail, AgentPlacement, Chat } from '../../api/types.ts';
import { useEarlierConversations } from '../../api/use-chat-earlier.ts';
import { type ChatLive, useChatLive } from '../../api/use-chat-live.ts';
import { useCompany } from '../../app/company.ts';
import { cx } from '../../components/cx.ts';
import { ErrorBlock, LoadingBlock } from '../../components/data/LoadState.tsx';
import type { Crumb } from '../../components/layout/Breadcrumbs.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { companyFlowLinks } from '../flows/links.ts';
import { useMarkSeen } from '../report-chats/seen.ts';
import { BranchedFrom } from './branch/BranchedFrom.tsx';
import { ChatTerminal } from './ChatTerminal.tsx';
import { Composer } from './Composer.tsx';
import { asking, chatActions, closedWhy, mayWrite, queueActions, queueView } from './chat-actions.ts';
import { ChatContextMeter } from './context/ChatContextMeter.tsx';
import { chatRuns } from './context/context-state.ts';
import { QueuedMessages } from './delivery/QueuedMessages.tsx';
import { CHAT_AREA, ChatBar } from './header/ChatBar.tsx';
import { ChatHeader, type ChatMode } from './header/ChatHeader.tsx';
import { chatMachine, fixOf } from './machine-context.ts';
import { AddMe } from './people/AddMe.tsx';
import { PeopleMenu } from './people/PeopleMenu.tsx';
import { type ChatPeople, useChatPeople } from './people/use-chat-people.ts';
import { RunnerUpdateNotice } from './RunnerUpdateNotice.tsx';
import { chatRunsMenus } from './runs/chat-runs.tsx';
import { useThreadAuthors } from './thread/authors.ts';
import { ChatThread } from './thread/ChatThread.tsx';
import { ChatMachineContext } from './thread/status/MachineWait.tsx';

export interface OpenChatProps {
  /** The path to the agent's chats, for the header. */
  readonly crumbs: readonly Crumb[];
  readonly companyId: string;
  readonly chatId: string;
  readonly agent: AgentDetail;
  readonly placement: AgentPlacement | undefined;
  readonly profiles: readonly AccessProfile[] | undefined;
  readonly admin: boolean;
  /** Members and above: they write in the message chats they are in (2026-11-14). */
  readonly member: boolean;
  readonly owner: boolean;
  /** The chat changed in a way the list shows (its title after the first prompt, its profile). */
  readonly onChanged: () => void;
  /** Where a chat of this agent opens (a branch's parent). */
  readonly hrefOf: (chatId: string) => string;
  /** A branch was made from a reply: the page lists and opens it. */
  readonly onBranched: (chat: Chat) => void;
}

/** The agent moved to another machine since the chat began: its conversation is not there. */
function MovedNotice() {
  return (
    <p className="flex items-center gap-2 bg-input-soft px-4 py-2 text-xs text-ink md:px-5">
      <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-input" />
      The agent runs on another machine now, so this chat's conversation isn't there: start a new chat.
    </p>
  );
}

/** The thread's Branch (admins and owners) and a branch's "Branched from" line. */
function branchView(
  calls: ChatCalls,
  live: ChatLive,
  chat: Chat,
  admin: boolean,
  rest: Pick<OpenChatProps, 'hrefOf' | 'onBranched'>,
) {
  const from = live.detail.data?.branchedFrom;
  return {
    branching: admin
      ? {
          harness: chat.harness,
          onBranch: async (turnId: string) => rest.onBranched(await calls.branch(chat.id, turnId)),
        }
      : undefined,
    lead: from ? <BranchedFrom from={from} at={chat.createdAt} hrefOf={rest.hrefOf} /> : undefined,
  };
}

/** The open chat's area in the page's frame (`CHAT_AREA`): the thread or the terminal; 80% of a narrow window. */
const BODY = cx(CHAT_AREA.body, 'flex h-[80dvh] min-h-0 min-w-0 flex-col lg:h-auto');

/** Before the chat's detail came: the header's path, and the loading state or the failure with Retry. */
function Opening({
  crumbs,
  detail,
}: {
  readonly crumbs: readonly Crumb[];
  readonly detail: ChatLive['detail'];
}) {
  return (
    <>
      <ChatBar crumbs={crumbs} />
      <div className={BODY}>
        {detail.error !== undefined ? (
          <ErrorBlock error={detail.error} onRetry={detail.reload} />
        ) : (
          <LoadingBlock label="Opening the chat…" />
        )}
      </div>
    </>
  );
}

/** The header's own parts for who is in the chat (2026-11-14): the owner view's mark, and the ⋯ menu's People. */
function peopleParts(people: ChatPeople) {
  return {
    badges: people.looksOn ? (
      <Badge size="sm" tone="pending" className="shrink-0">
        Owner view
      </Badge>
    ) : undefined,
    more: people.message ? (
      <PeopleMenu
        people={people.people}
        nodes={people.nodes}
        reader={people.reader}
        looksOn={people.looksOn}
        actions={people.actions}
      />
    ) : undefined,
  };
}

/** Send in Slack (2026-11-14) for the Slack connection's owner in its conversation's chat; none for anyone else. */
function slackOf(calls: ChatCalls, live: ChatLive, chat: Chat, people: ChatPeople) {
  const { slack } = people;
  if (slack === null || !slack.mayPost) return undefined;
  return {
    place: slack.place,
    onSend: async (text: string) => live.putTurn(await calls.sendInSlack(chat.id, text)),
  };
}

/**
 * The open chat (S5.1c): its header across the page's frame, then the live thread with the composer, or the terminal.
 * The chat and its turns come from `useChatLive` (the detail, then the stream); a prompt, a stop and a profile change
 * show their answer at once, before the stream says the same. Since 2026-11-14 its ⋯ menu lists who is in it (People),
 * an owner who is not in it reads it in the owner view (a mark, and Add me in place of the composer), and a Slack
 * conversation's chat lets its Slack connection's owner send in Slack; a task's conversation leads back to its task
 * (T-19).
 */
export function OpenChat({
  companyId,
  chatId,
  agent,
  placement,
  admin,
  member,
  owner,
  ...rest
}: OpenChatProps) {
  const api = useApi();
  const calls = useMemo(() => chatCalls(api, companyId), [api, companyId]);
  const live = useChatLive(companyId, chatId);
  const folds = useEarlierConversations(calls, chatId);
  const authors = useThreadAuthors(companyId, agent);
  const people = useChatPeople(calls, live.detail, chatId, owner);
  const { slug } = useCompany().membership;
  const forTask = live.detail.data?.forTask;
  const [mode, setMode] = useState<ChatMode>('chat');
  // The rail's dot for a direct report's chat clears once its reply shows here.
  useMarkSeen(chatId, live.turns);
  const chat = live.chat;
  if (chat === undefined) return <Opening crumbs={rest.crumbs} detail={live.detail} />;
  const actions = chatActions(calls, live, chat, rest.onChanged);
  const { thread, queue, running, choices } = queueView(live, chat);
  const sessionCwd = live.detail.data?.init?.cwd;
  const header = {
    crumbs: rest.crumbs,
    companyId,
    agent,
    placement,
    chat,
    admin: admin && !people.looksOn,
    owner: owner && !people.looksOn,
    mode,
    profiles: rest.profiles,
    sessionCwd,
    ...peopleParts(people),
    task: forTask ? { ...forTask, href: companyFlowLinks(slug).task(forTask.key) } : undefined,
  };
  const closed = closedWhy(chat, mayWrite(chat, admin, member), placement, people.looksOn);
  const placeholder = asking(thread) ? 'Answer above, or write your answer here' : `Message ${agent.name}`;
  const runnerUpdate = admin ? live.detail.data?.runnerUpdateFor : null;
  return (
    <>
      <ChatHeader {...header} stream={live.stream} onMode={setMode} onProfile={actions.changeProfile} />
      <div className={BODY}>
        {placement && placement.machineId !== chat.machineId && <MovedNotice />}
        {mode === 'terminal' && owner && !people.looksOn ? (
          <ChatTerminal companyId={companyId} chat={chat} />
        ) : (
          <ChatMachineContext.Provider
            value={chatMachine(calls, live, chat, companyId, fixOf(closed, placement, actions.send))}
          >
            <ChatThread
              turns={thread}
              agentName={agent.name}
              authors={authors}
              chatInit={live.detail.data?.init ?? undefined}
              answering={{ answer: actions.answer, closed }}
              history={{ live: live.earlier, folds }}
              decisions={live.decisions}
              {...branchView(calls, live, chat, admin && !people.looksOn, rest)}
            />
            {runnerUpdate && (
              <RunnerUpdateNotice companyId={companyId} machineId={chat.machineId} tools={runnerUpdate} />
            )}
            <Composer
              running={running !== undefined}
              choices={choices}
              disabled={closed}
              placeholder={placeholder}
              onSend={actions.send}
              onStop={actions.stop}
              aside={people.looksOn ? <AddMe people={people} /> : undefined}
              slack={slackOf(calls, live, chat, people)}
              queue={<QueuedMessages queue={queue} actions={queueActions(calls, live, chat, running)} />}
              runs={chatRunsMenus({ calls, live, chat, closed, agent, mine: rest.profiles })}
              meter={
                <ChatContextMeter
                  calls={calls}
                  live={live}
                  chat={chat}
                  closed={closed}
                  runs={chatRuns(chat, agent, rest.profiles)}
                />
              }
            />
          </ChatMachineContext.Provider>
        )}
      </div>
    </>
  );
}
