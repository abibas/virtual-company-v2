import type { ContactAgentCount } from '../../api/contacts.ts';
import { formatDateTime, fromNow } from '../../components/data/format.ts';
import { List, ListRow } from '../../components/data/List.tsx';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { useAgentFaces } from './use-agent-faces.ts';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Which agents a contact talked to (2026-11-14, docs/subscriptions.md "Contacts"): per agent, their messages and
 * conversations there and when they last wrote, the one talked to last first. Nothing when there is none.
 */
export function ContactAgents({ agents }: { readonly agents: readonly ContactAgentCount[] }) {
  const faceOf = useAgentFaces();
  if (agents.length === 0) return null;
  return (
    <Panel title="Agents" padding="sm">
      <List divided>
        {agents.map((count) => (
          <ListRow
            key={count.agent.id}
            leading={<AgentIcon agent={faceOf(count.agent)} size="sm" />}
            title={count.agent.name}
            subtitle={plural(count.conversations, 'conversation')}
            value={plural(count.messages, 'message')}
            meta={
              <time dateTime={count.lastAt} title={formatDateTime(count.lastAt)}>
                {fromNow(count.lastAt)}
              </time>
            }
          />
        ))}
      </List>
    </Panel>
  );
}
