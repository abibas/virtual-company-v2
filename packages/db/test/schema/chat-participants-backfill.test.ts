import { randomBytes } from 'node:crypto';
import { newId } from '@mwc/shared/ids';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import {
  type Agent,
  chatParticipants,
  chats,
  contacts,
  credentials,
  flows,
  orgPositions,
  slackThreads,
} from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertAgent, insertCompany, insertMachine, insertMember, insertUser } from '../fixtures/rows.ts';

/**
 * The data steps of migration `0040_chat_participants` (the `-- custom:` part of its SQL): who is in each message chat
 * made before it. A person's chat gets its creator; a Slack conversation's chat its contacts (who started it, and who
 * wrote in it) and the Slack connection's owner; one with no member yet the agent's manager, else every active owner. A
 * flow's team chat (as a task's conversation) gets nobody. Seeded at `0039_contacts`, whose tables 0040 leaves as they
 * were, so the rows are written with the schema as it is, except a turn (`0042` adds a column to `chat_turns`).
 */

let testDb: TestDb;
let handle: RawDbHandle;
const ids: Record<string, string> = {};

const bytes = (size: number) => new Uint8Array(randomBytes(size));
const at = new Date(Date.UTC(2026, 10, 10, 9));

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0039_contacts');
});
afterAll(() => testDb.close());

/** A chat of the agent, made by this principal, with a flow when given. */
async function chat(agent: Agent, machineId: string, createdBy: string, flowId?: string): Promise<string> {
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: agent.companyId,
      agentId: agent.id,
      harness: 'claude_code',
      machineId,
      createdBy,
      createdAt: at,
      ...(flowId ? { flowId } : {}),
    })
    .returning();
  return (row as { id: string }).id;
}

async function contact(companyId: string, user: string): Promise<string> {
  const [row] = await handle.db
    .insert(contacts)
    .values({
      companyId,
      source: 'slack',
      name: user,
      slackTeamId: 'T0AIRIA',
      slackUserId: user,
      firstSeenAt: at,
      lastSeenAt: at,
    })
    .returning();
  return (row as { id: string }).id;
}

async function signIn(ownerUserId: string): Promise<string> {
  const [row] = await handle.db
    .insert(credentials)
    .values({
      ownerUserId,
      kind: 'slack_bot_token',
      label: `Slack ${ownerUserId}`,
      keyVersion: 1,
      iv: bytes(12),
      authTag: bytes(16),
      ciphertext: bytes(40),
    })
    .returning();
  return (row as { id: string }).id;
}

/** A Slack conversation's chat: its thread row (the contact who started it) and a turn from another contact. */
async function slackChat(agent: Agent, machineId: string, credentialId: string, channelId: string) {
  const chatId = await chat(agent, machineId, agent.principalId);
  const starter = await contact(agent.companyId, `U${channelId}1`);
  const writer = await contact(agent.companyId, `U${channelId}2`);
  await handle.db.insert(slackThreads).values({
    companyId: agent.companyId,
    agentId: agent.id,
    chatId,
    credentialId,
    channelId,
    threadTs: '1731.1',
    place: '#general',
    contactId: starter,
  });
  const sender = {
    via: 'slack',
    userId: `U${channelId}2`,
    name: 'Anna',
    avatarUrl: null,
    link: null,
  } as const;
  // Written with the columns `chat_turns` had at `0039` (a later migration adds its own, which drizzle would name).
  await queryRows(
    handle,
    sql`insert into chat_turns (id, company_id, chat_id, seq, prompt, status, system, sender, contact_id, created_by)
        values (${newId()}, ${agent.companyId}, ${chatId}, 1, 'Slack message from Anna', 'done', true,
                ${JSON.stringify(sender)}::jsonb, ${writer}, ${agent.principalId})`,
  );
  return { chatId, starter, writer };
}

describe(`0040_chat_participants on ${testDbKind()}: who is in each chat so far`, () => {
  beforeAll(async () => {
    const acme = await insertCompany(handle);
    const mac = (await insertMachine(handle, acme.id)).id;
    const owner = await insertMember(handle, acme.id, { role: 'owner', grantedRole: 'owner' });
    await insertMember(handle, acme.id, { role: 'owner', grantedRole: 'owner', status: 'suspended' });
    const writer = await insertMember(handle, acme.id);
    const boss = await insertMember(handle, acme.id);
    const slacker = await insertMember(handle, acme.id, { role: 'admin', grantedRole: 'admin' });
    const managed = await insertAgent(handle, acme.id);
    const loose = await insertAgent(handle, acme.id);
    await handle.db.insert(orgPositions).values([
      { companyId: acme.id, principalId: managed.principalId, reportsToPrincipalId: boss.principal.id },
      { companyId: acme.id, principalId: loose.principalId, reportsToPrincipalId: managed.principalId },
    ]);
    const [flow] = await handle.db
      .insert(flows)
      .values({
        companyId: acme.id,
        leadPrincipalId: managed.principalId,
        name: 'Delivery',
        createdBy: writer.principal.id,
      })
      .returning();
    ids.owner = owner.principal.id;
    ids.writer = writer.principal.id;
    ids.boss = boss.principal.id;
    ids.slacker = slacker.principal.id;
    ids.own = await chat(managed, mac, writer.principal.id);
    ids.team = await chat(managed, mac, writer.principal.id, (flow as { id: string }).id);
    const ours = await slackChat(managed, mac, await signIn(slacker.user.id), 'C1');
    ids.slack = ours.chatId;
    ids.starter = ours.starter;
    ids.slackWriter = ours.writer;
    const outsider = await insertUser(handle);
    const theirs = await slackChat(managed, mac, await signIn(outsider.id), 'C2');
    ids.orphan = theirs.chatId;
    ids.orphanStarter = theirs.starter;
    ids.orphanWriter = theirs.writer;
    ids.old = await chat(loose, mac, loose.principalId);
    await migrateToLatest(handle);
  });

  const peopleOf = async (chatId: string | undefined) => {
    const rows = await handle.db
      .select()
      .from(chatParticipants)
      .where(eq(chatParticipants.chatId, chatId as string));
    return rows.map((row) => row.principalId ?? row.contactId).sort();
  };

  it("puts a person's chat's creator in it, as Most Wanted, when the chat began", async () => {
    expect(await peopleOf(ids.own)).toEqual([ids.writer]);
    const [row] = await handle.db
      .select()
      .from(chatParticipants)
      .where(eq(chatParticipants.chatId, ids.own as string));
    expect(row).toMatchObject({ addedBy: null, addedAt: at });
  });

  it("puts a Slack conversation's contacts and its connection's owner in its chat", async () => {
    expect(await peopleOf(ids.slack)).toEqual([ids.starter, ids.slackWriter, ids.slacker].sort());
  });

  it("gives a chat with no member the agent's manager, else the active owners", async () => {
    expect(await peopleOf(ids.orphan)).toEqual([ids.orphanStarter, ids.orphanWriter, ids.boss].sort());
    expect(await peopleOf(ids.old)).toEqual([ids.owner]);
  });

  it("leaves a flow's team chat with nobody: it keeps its own rules", async () => {
    expect(await peopleOf(ids.team)).toEqual([]);
  });
});
