import { MessagesSquare } from 'lucide-react';
import type { Contact, ContactConversation } from '../../api/contacts.ts';
import { formatDateTime, formatTime, fromNow } from '../../components/data/format.ts';
import { List, ListRow } from '../../components/data/List.tsx';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { chatsPath } from '../agents/links.ts';
import { StateDot } from '../report-chats/ReportFace.tsx';
import { useAgentFaces } from './use-agent-faces.ts';

/** When a message was written: today's by its time, older ones by the day. */
function Ago({ at }: { readonly at: string }) {
  const today = new Date(at).toDateString() === new Date().toDateString();
  return (
    <time dateTime={at} title={formatDateTime(at)}>
      {today ? formatTime(at) : fromNow(at)}
    </time>
  );
}

/** The last message's line: who said it (the agent, or the contact's first name) and what. */
function lastLine(conversation: ContactConversation, contact: Contact): string | undefined {
  const { last } = conversation;
  if (last === null) return undefined;
  const who = last.by === 'agent' ? conversation.agent.name : (contact.name.split(' ')[0] ?? contact.name);
  return `${who}: ${last.text}`;
}

/** One conversation: its agent's face (green while a turn runs there), where it is, its last message, opening the chat. */
function ConversationRow({
  conversation,
  contact,
  slug,
}: {
  readonly conversation: ContactConversation;
  readonly contact: Contact;
  readonly slug: string;
}) {
  const faceOf = useAgentFaces();
  const { agent, last } = conversation;
  const where = [agent.name, conversation.place, conversation.archived && 'Archived']
    .filter(Boolean)
    .join(' · ');
  return (
    <ListRow
      href={chatsPath(slug, agent.id, conversation.chatId)}
      leading={
        <span className="relative shrink-0">
          <AgentIcon agent={faceOf(agent)} size="sm" />
          <StateDot dot={conversation.live ? 'working' : null} className="-right-0.5 -bottom-0.5" />
        </span>
      }
      title={conversation.title ?? where}
      subtitle={
        <>
          <span className="text-faint">{where}</span>
          {lastLine(conversation, contact) && (
            <span className="ml-1.5">{lastLine(conversation, contact)}</span>
          )}
        </>
      }
      meta={<Ago at={last?.at ?? conversation.updatedAt} />}
    />
  );
}

/**
 * A contact's conversations with the company's agents (2026-11-14, docs/subscriptions.md "Contacts"), the latest first:
 * each Slack chat with its agent's face, its last message and a link to open it.
 */
export function ContactConversations({
  contact,
  conversations,
  slug,
}: {
  readonly contact: Contact;
  readonly conversations: readonly ContactConversation[];
  readonly slug: string;
}) {
  return (
    <Panel title="Conversations" padding="sm">
      {conversations.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="No conversations" size="sm" />
      ) : (
        <List divided>
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.chatId}
              conversation={conversation}
              contact={contact}
              slug={slug}
            />
          ))}
        </List>
      )}
    </Panel>
  );
}
