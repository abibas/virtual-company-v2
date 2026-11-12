import {
  type Agent,
  agents,
  type Chat,
  chats,
  isUuid,
  type TenantDb,
  type TenantSet,
  type TenantValues,
} from '@mwc/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * The chats' rows, through the company's tenant only (S5.1b): the chats themselves, and the agent a chat is with (read
 * only: the agents are the org module's), and a flow's team chat with its Lead agent (S6c). The turns and their events
 * are `repo/turns.ts`'s, the access profiles `repo/profiles.ts`'s.
 */

/** The agent's fields a chat needs; undefined for an unknown, malformed or another company's id. */
async function agentOf(t: TenantDb, id: string): Promise<Agent | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(agents, eq(agents.id, id));
  return row;
}

/** The agent of this principal (a well-formed id), archived ones too; undefined for none. */
async function agentByPrincipal(t: TenantDb, principalId: string): Promise<Agent | undefined> {
  if (!isUuid(principalId)) return undefined;
  const [row] = await t.select(agents, eq(agents.principalId, principalId));
  return row;
}

/** The flow's latest team chat with this agent, not archived (S6c); undefined for none. */
async function teamChatOf(t: TenantDb, flowId: string, agentId: string): Promise<Chat | undefined> {
  const [row] = await t
    .select(chats, and(eq(chats.flowId, flowId), eq(chats.agentId, agentId), isNull(chats.archivedAt)))
    .orderBy(desc(chats.createdAt), desc(chats.id))
    .limit(1);
  return row;
}

/** One chat of the company; undefined for an unknown, malformed or another company's id. */
async function get(t: TenantDb, id: string): Promise<Chat | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(chats, eq(chats.id, id));
  return row;
}

/** The agent's own chats not archived, the latest first: a task's conversations (S5.3b) stay out of the list. */
const ofAgent = (t: TenantDb, agentId: string): Promise<Chat[]> =>
  t
    .select(chats, and(eq(chats.agentId, agentId), isNull(chats.archivedAt), isNull(chats.taskId)))
    .orderBy(desc(chats.updatedAt), desc(chats.id));

async function insert(t: TenantDb, values: TenantValues<typeof chats>): Promise<Chat> {
  const [row] = (await t.insert(chats, values).returning()) as [Chat];
  return row;
}

/** Changes a chat (by the id of a row read first); `updated_at` moves with it. */
async function update(t: TenantDb, id: string, set: TenantSet<typeof chats>): Promise<Chat> {
  const [row] = (await t.update(chats, set, eq(chats.id, id)).returning()) as [Chat];
  return row;
}

/**
 * Saves the session a turn said (its `session` event). A branch waiting for its fork (`fork_pending`) stops waiting
 * only when that session is another than the one it had (the parent's): a session event naming the parent's own would
 * mean nothing was forked, and the next turn must fork again rather than resume the parent's conversation in place.
 */
async function saveSession(t: TenantDb, id: string, sessionId: string): Promise<void> {
  const chat = (await get(t, id)) as Chat;
  const forked = chat.forkPending && chat.sessionId !== sessionId ? { forkPending: false } : {};
  await update(t, id, { sessionId, ...forked });
}

export const chatsRepo = { agentOf, agentByPrincipal, teamChatOf, get, ofAgent, insert, update, saveSession };
