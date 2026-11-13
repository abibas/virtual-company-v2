import { createContext, useContext, useMemo } from 'react';
import { useOrgChart } from '../../../api/org.ts';
import type { ChartNode, ChatTurn, Me } from '../../../api/types.ts';
import { useCompany } from '../../../app/company.ts';
import type { AgentIconSubject } from '../../../components/feed/AgentIcon.tsx';
import { type MessageAuthorView, SYSTEM_AUTHOR } from '../../../components/feed/MessageAuthor.tsx';
import { nodesById } from '../../../components/org/chart.ts';
import { personName } from '../../../components/ui/Avatar.tsx';

/** Who wrote a turn's prompt, and whether it is the person reading (their own messages sit on the right). */
export interface Prompter {
  readonly author: MessageAuthorView;
  readonly own: boolean;
}

/** Who writes in a thread: the chat's agent (every reply), and who wrote each prompt. */
export interface ThreadAuthors {
  readonly agent: MessageAuthorView;
  readonly prompter: (turn: Pick<ChatTurn, 'system' | 'createdBy' | 'from'>) => Prompter;
}

/** The signed-in person, as `GET /api/me` gives them. */
export type Reader = Pick<Me['user'], 'id' | 'displayName' | 'email' | 'imageUrl'>;

const personAuthor = (
  displayName: string | null,
  email: string,
  imageUrl: string | null,
): MessageAuthorView => ({
  kind: 'person',
  name: personName(displayName, email),
  imageUrl,
});

/** The outside place a turn Most Wanted queued came from, as its author's "via" (2026-11-13: a Slack message). */
const VIA: Readonly<Record<NonNullable<ChatTurn['from']>['via'], string>> = { slack: 'Slack' };

/** A Slack message's sender as its turn's author: their name, via Slack. */
const viaAuthor = (from: NonNullable<ChatTurn['from']>): MessageAuthorView => ({
  kind: 'person',
  name: from.name,
  via: VIA[from.via],
});

type AgentNode = Extract<ChartNode, { kind: 'agent' }>;

const agentSubject = ({ agent }: AgentNode): AgentIconSubject => ({
  id: agent.agentId,
  name: agent.name,
  face: agent.face,
  icon: agent.icon,
  status: agent.status,
});

/** A principal on the chart as a message's author. */
export function nodeAuthor(node: ChartNode): MessageAuthorView {
  if (node.kind === 'agent') return { kind: 'agent', name: node.agent.name, agent: agentSubject(node) };
  const { displayName, email, imageUrl } = node.person;
  return personAuthor(displayName, email, imageUrl);
}

/** The agent a principal names, as its icon draws it from the chart; by its name alone when it is not there. */
export function replierOf(
  who: { readonly principalId: string; readonly name: string } | null | undefined,
  nodes: ReadonlyMap<string, ChartNode>,
): AgentIconSubject {
  const node = who ? nodes.get(who.principalId) : undefined;
  return node?.kind === 'agent' ? agentSubject(node) : { name: who?.name ?? 'the agent' };
}

/**
 * The thread's authors from the company's chart (`nodes`, by principal; none while it loads) and the reader. A prompt
 * Most Wanted queued for a Slack message is its sender's, via Slack; any other it queued itself is its own; any other is its writer's, found on the chart. Until the chart comes, a
 * person's prompt is taken as the reader's (the usual case: admins write in their agents' chats); someone no longer on
 * the chart shows as a former member.
 */
export function threadAuthors({
  agent,
  nodes,
  reader,
}: {
  readonly agent: AgentIconSubject;
  readonly nodes: ReadonlyMap<string, ChartNode> | undefined;
  readonly reader: Reader | undefined;
}): ThreadAuthors {
  const replier: MessageAuthorView = { kind: 'agent', name: agent.name, agent };
  const self: Prompter = {
    author: reader
      ? personAuthor(reader.displayName, reader.email, reader.imageUrl)
      : { kind: 'person', name: 'You' },
    own: true,
  };
  return {
    agent: replier,
    prompter: (turn) => {
      if (turn.system && turn.from) return { author: viaAuthor(turn.from), own: false };
      if (turn.system) return { author: SYSTEM_AUTHOR, own: false };
      if (nodes === undefined) return self;
      const node = nodes.get(turn.createdBy);
      if (node === undefined) return { author: { kind: 'person', name: 'Former member' }, own: false };
      if (node.kind === 'person' && node.person.userId === reader?.id)
        return { ...self, author: nodeAuthor(node) };
      return { author: nodeAuthor(node), own: false };
    },
  };
}

/** The thread's authors for a chat with `agent`, from the company's chart (loaded here) and the signed-in person. */
export function useThreadAuthors(companyId: string, agent: AgentIconSubject): ThreadAuthors {
  const chart = useOrgChart(companyId);
  const reader = useCompany().me.user;
  const nodes = useMemo(() => (chart.data ? nodesById(chart.data.nodes) : undefined), [chart.data]);
  return useMemo(() => threadAuthors({ agent, nodes, reader }), [agent, nodes, reader]);
}

/** What the thread's turns read their authors from: the authors, and whether the thread is narrow (smaller faces). */
export interface ThreadLook {
  readonly authors: ThreadAuthors;
  readonly dense: boolean;
}

export const ThreadLookContext = createContext<ThreadLook | null>(null);

/** The thread's look; outside a thread that gives one, the agent by its name and every prompt the reader's. */
export function useThreadLook(agentName: string): ThreadLook {
  const look = useContext(ThreadLookContext);
  return useMemo(
    () =>
      look ?? {
        authors: threadAuthors({ agent: { name: agentName }, nodes: undefined, reader: undefined }),
        dense: false,
      },
    [look, agentName],
  );
}
