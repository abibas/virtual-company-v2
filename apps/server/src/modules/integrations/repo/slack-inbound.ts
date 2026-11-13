import {
  type Agent,
  accessProfiles,
  agents,
  type Credential,
  credentials,
  type DbHandle,
  type OwnedDb,
  type OwnedSet,
  owned,
  ownersOf,
  type SlackConnection,
  type SlackThread,
  slackConnections,
  slackPosts,
  slackThreads,
  type TenantDb,
} from '@mwc/db';
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';

/**
 * Receiving Slack messages' data (2026-11-13): a bot sign-in's inbound settings and the agents' posts (personal rows of
 * the sign-in's owner, through `owned`), the agents' chats per Slack conversation (a company's, through the tenant), and
 * the agents a connection may route to (by their profiles' Slack part).
 */

/** The owner's settings of a sign-in; undefined when it has none yet. */
async function connectionOf(o: OwnedDb, credentialId: string): Promise<SlackConnection | undefined> {
  const [row] = await o.select(slackConnections, eq(slackConnections.credentialId, credentialId));
  return row;
}

/** Writes the sign-in's settings: its row made with these values, or changed. */
async function saveConnection(
  o: OwnedDb,
  credentialId: string,
  set: OwnedSet<typeof slackConnections>,
): Promise<SlackConnection> {
  const [row] = await o
    .insert(slackConnections, { ...set, credentialId })
    .onConflictDoUpdate({ target: slackConnections.credentialId, set: { ...set, updatedAt: new Date() } })
    .returning();
  return row as SlackConnection;
}

/** Records where the sign-in's Socket Mode stands. */
async function setStatus(
  db: DbHandle,
  owner: { readonly ownerUserId: string; readonly credentialId: string },
  status: Pick<SlackConnection, 'status' | 'statusMessage' | 'statusAt'>,
): Promise<void> {
  const o = owned(db, owner.ownerUserId);
  await o.update(slackConnections, status, eq(slackConnections.credentialId, owner.credentialId));
}

/** One of the owner's sign-ins; undefined for none of theirs. */
async function signInOf(o: OwnedDb, credentialId: string): Promise<Credential | undefined> {
  const [row] = await o.select(credentials, eq(credentials.id, credentialId));
  return row;
}

/** The owner's Slack user tokens (whose person may be listed first). */
const userTokensOf = (o: OwnedDb) =>
  o.select(credentials, and(eq(credentials.kind, 'slack_user_token'), ne(credentials.status, 'revoked')));

/** The owner's profiles whose Slack part uses this sign-in. */
async function profilesUsing(o: OwnedDb, credentialId: string): Promise<string[]> {
  const rows = await o.select(accessProfiles, eq(accessProfiles.slackCredentialId, credentialId));
  return rows.map((row) => row.id);
}

/** A message an agent posted through a sign-in (its owner's row); one already recorded is left as it is. */
async function recordPost(
  o: OwnedDb,
  post: Omit<typeof slackPosts.$inferInsert, 'ownerUserId' | 'id' | 'at'> & { readonly at: Date },
): Promise<void> {
  await o.insert(slackPosts, post).onConflictDoNothing();
}

/** The agent that last posted in a thread through the sign-in (its first message or a reply); undefined for none. */
async function threadPoster(o: OwnedDb, credentialId: string, channelId: string, root: string) {
  const [row] = await o
    .select(
      slackPosts,
      and(
        eq(slackPosts.credentialId, credentialId),
        eq(slackPosts.channelId, channelId),
        or(eq(slackPosts.ts, root), eq(slackPosts.threadTs, root)),
      ),
    )
    .orderBy(desc(slackPosts.at), desc(slackPosts.id))
    .limit(1);
  return row;
}

/** True when the turn already posted in the conversation (the thread, or the DM itself). */
async function postedInTurn(
  o: OwnedDb,
  turn: { readonly credentialId: string; readonly turnId: string; readonly channelId: string },
  root: string | null,
): Promise<boolean> {
  const rows = await o.select(
    slackPosts,
    and(
      eq(slackPosts.credentialId, turn.credentialId),
      eq(slackPosts.turnId, turn.turnId),
      eq(slackPosts.channelId, turn.channelId),
      root === null ? undefined : or(eq(slackPosts.threadTs, root), eq(slackPosts.ts, root)),
    ),
  );
  return rows.length > 0;
}

/** Whose a sign-in is, from a company's side; undefined when it is gone. */
const ownerOfSignIn = async (t: TenantDb, credentialId: string) =>
  (await ownersOf(t, credentials, [credentialId])).get(credentialId);

/** The agent's chat for a Slack conversation through a sign-in; undefined for none yet. */
async function threadOf(
  t: TenantDb,
  key: Pick<SlackThread, 'agentId' | 'credentialId' | 'channelId' | 'threadTs'>,
): Promise<SlackThread | undefined> {
  const [row] = await t.select(
    slackThreads,
    and(
      eq(slackThreads.agentId, key.agentId),
      eq(slackThreads.credentialId, key.credentialId),
      eq(slackThreads.channelId, key.channelId),
      key.threadTs === null ? isNull(slackThreads.threadTs) : eq(slackThreads.threadTs, key.threadTs),
    ),
  );
  return row;
}

/** The Slack conversation a chat is for; undefined for any other chat. */
async function threadOfChat(t: TenantDb, chatId: string): Promise<SlackThread | undefined> {
  const [row] = await t.select(slackThreads, eq(slackThreads.chatId, chatId));
  return row;
}

/** Saves the agent's chat for the conversation: a new row, or the chat that replaced its old one. */
async function saveThread(
  t: TenantDb,
  values: Pick<SlackThread, 'agentId' | 'chatId' | 'credentialId' | 'channelId' | 'threadTs' | 'place'>,
): Promise<void> {
  const found = await threadOf(t, values);
  if (found === undefined) await t.insert(slackThreads, values);
  else if (found.chatId !== values.chatId)
    await t.update(
      slackThreads,
      { chatId: values.chatId, place: values.place },
      eq(slackThreads.id, found.id),
    );
}

/** The company's agents that are not archived: all, or those of these profiles. */
async function liveAgents(t: TenantDb, profileIds?: readonly string[]): Promise<Agent[]> {
  if (profileIds?.length === 0) return [];
  const archived = ne(agents.status, 'archived');
  return t.select(
    agents,
    profileIds === undefined ? archived : and(archived, inArray(agents.profileId, profileIds)),
  );
}

/** One agent of the company, unless it is archived. */
async function liveAgent(t: TenantDb, agentId: string): Promise<Agent | undefined> {
  const [row] = await t.select(agents, and(eq(agents.id, agentId), ne(agents.status, 'archived')));
  return row;
}

export const slackInboundRepo = {
  connectionOf,
  saveConnection,
  setStatus,
  signInOf,
  userTokensOf,
  profilesUsing,
  recordPost,
  threadPoster,
  postedInTurn,
  ownerOfSignIn,
  threadOf,
  threadOfChat,
  saveThread,
  liveAgents,
  liveAgent,
};
