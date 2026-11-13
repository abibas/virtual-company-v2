import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Agent,
  type Chat,
  type Company,
  type Credential,
  chats,
  credentials,
  type NewSlackConnection,
  slackConnections,
  slackPosts,
  slackThreads,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertAgent, insertCompany, insertMachine, insertUser, migratedTestDb } from '../fixtures/rows.ts';

/**
 * Receiving Slack messages (migration 0037): a bot sign-in's inbound settings with its sealed app token (all of it or
 * none, inbound only with one, the people, the default agent, the cap, the status), the agents' posts by message, and an
 * agent's chat per Slack conversation (a company's row, a DM's own conversation once), all removed with the sign-in.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let ownerId: string;
let acme: Company;
let globex: Company;
let agent: Agent;
let chat: Chat;

const bytes = (size: number) => new Uint8Array(randomBytes(size));

async function signIn(): Promise<Credential> {
  const [row] = await handle.db
    .insert(credentials)
    .values({
      ownerUserId: ownerId,
      kind: 'slack_bot_token',
      label: 'Slack · Airia',
      keyVersion: 1,
      iv: bytes(12),
      authTag: bytes(16),
      ciphertext: bytes(40),
    })
    .returning();
  return row as Credential;
}

const sealedApp = { appKeyVersion: 1, appIv: bytes(12), appAuthTag: bytes(16), appCiphertext: bytes(48) };

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  ownerId = (await insertUser(handle)).id;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  agent = await insertAgent(handle, acme.id);
  const mac = await insertMachine(handle, acme.id);
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: acme.id,
      agentId: agent.id,
      harness: 'claude_code',
      machineId: mac.id,
      createdBy: agent.principalId,
    })
    .returning();
  chat = row as Chat;
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

async function connection(values: Partial<NewSlackConnection> = {}) {
  const credentialId = values.credentialId ?? (await signIn()).id;
  return handle.db
    .insert(slackConnections)
    .values({ credentialId, ownerUserId: ownerId, ...values })
    .returning();
}

describe('slack_connections', () => {
  it('starts off, listed people only, none listed, no default agent, 30 an hour, with no app token', async () => {
    const [row] = await connection();
    expect(row).toMatchObject({
      inbound: false,
      wake: 'listed',
      people: [],
      defaultCompanyId: null,
      maxPerHour: 30,
      status: 'off',
      statusMessage: null,
      appCiphertext: null,
    });
  });

  it('keeps an app token sealed whole or not at all, and receives only with one', async () => {
    const [row] = await connection({ ...sealedApp, inbound: true, wake: 'anyone' });
    expect(row?.inbound).toBe(true);
    expect(await constraint(connection({ ...sealedApp, appIv: null }))).toBe(
      'slack_connections_app_token_check',
    );
    expect(await constraint(connection({ ...sealedApp, appIv: bytes(8) }))).toBe(
      'slack_connections_app_iv_check',
    );
    expect(await constraint(connection({ ...sealedApp, appAuthTag: bytes(8) }))).toBe(
      'slack_connections_app_auth_tag_check',
    );
    expect(await constraint(connection({ inbound: true }))).toBe('slack_connections_inbound_check');
  });

  it('checks the wake rule, the people, the default agent, the cap and the status', async () => {
    expect(await constraint(connection({ wake: 'everyone' as never }))).toBe('slack_connections_wake_check');
    expect(await constraint(connection({ people: {} as never }))).toBe('slack_connections_people_check');
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `U${i}`, name: 'x', image: null }));
    expect(await constraint(connection({ people: many }))).toBe('slack_connections_people_check');
    expect(await constraint(connection({ defaultAgentId: agent.id }))).toBe(
      'slack_connections_default_agent_check',
    );
    expect(await constraint(connection({ maxPerHour: 0 }))).toBe('slack_connections_max_per_hour_check');
    expect(await constraint(connection({ maxPerHour: 501 }))).toBe('slack_connections_max_per_hour_check');
    expect(await constraint(connection({ status: 'up' as never }))).toBe('slack_connections_status_check');
    expect(await constraint(connection({ statusMessage: '' }))).toBe(
      'slack_connections_status_message_check',
    );
  });

  it('goes with its sign-in, its posts too', async () => {
    const sign = await signIn();
    await connection({ credentialId: sign.id });
    await handle.db.insert(slackPosts).values({
      ownerUserId: ownerId,
      credentialId: sign.id,
      channelId: 'C0GENERAL1',
      ts: '1731.1',
      companyId: acme.id,
      agentId: agent.id,
    });
    await handle.db.delete(credentials).where(eq(credentials.id, sign.id));
    expect(
      await handle.db.select().from(slackConnections).where(eq(slackConnections.credentialId, sign.id)),
    ).toEqual([]);
    expect(await handle.db.select().from(slackPosts).where(eq(slackPosts.credentialId, sign.id))).toEqual([]);
  });
});

describe('slack_posts', () => {
  it('keeps one row per message of a sign-in', async () => {
    const sign = await signIn();
    const post = { ownerUserId: ownerId, credentialId: sign.id, channelId: 'C1', ts: '1.1' };
    const ids = { companyId: acme.id, agentId: agent.id };
    await handle.db.insert(slackPosts).values({ ...post, ...ids, threadTs: '1.0' });
    expect(await constraint(handle.db.insert(slackPosts).values({ ...post, ...ids }))).toBe(
      'slack_posts_message_unique',
    );
    expect(await constraint(handle.db.insert(slackPosts).values({ ...post, ...ids, ts: '' }))).toBe(
      'slack_posts_ts_check',
    );
  });
});

describe('slack_threads', () => {
  it('holds one chat per agent, sign-in, channel and thread; a DM’s own conversation once', async () => {
    const sign = await signIn();
    const thread = {
      companyId: acme.id,
      agentId: agent.id,
      chatId: chat.id,
      credentialId: sign.id,
      channelId: 'D0DM',
      place: 'a DM with Ihor',
    };
    const [row] = await handle.db.insert(slackThreads).values(thread).returning();
    expect(row).toMatchObject({ threadTs: null, place: 'a DM with Ihor' });
    expect(
      await constraint(
        handle.db.insert(slackThreads).values({ ...thread, chatId: chat.id, channelId: 'D0DM' }),
      ),
    ).toBe('slack_threads_conversation_unique');
    expect(await constraint(handle.db.insert(slackThreads).values({ ...thread, threadTs: '1.0' }))).toBe(
      'slack_threads_chat_unique',
    );
    expect(await constraint(handle.db.insert(slackThreads).values({ ...thread, place: '' }))).toBe(
      'slack_threads_place_check',
    );
  });

  it('never points at another company’s agent or chat', async () => {
    const thread = {
      companyId: globex.id,
      agentId: agent.id,
      chatId: chat.id,
      credentialId: (await signIn()).id,
      channelId: 'C1',
      place: '#general',
    };
    expect(await constraint(handle.db.insert(slackThreads).values(thread))).toBe('slack_threads_agent_fk');
  });
});
