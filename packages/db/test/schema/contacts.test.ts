import { newId } from '@mwc/shared/ids';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import {
  type Agent,
  type Chat,
  type Company,
  type Contact,
  chats,
  chatTurns,
  contacts,
  decisions,
  type NewChatTurn,
  type NewContact,
  slackThreads,
} from '../../src/schema/index.ts';
import { createTestDb, pgError, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertAgent, insertCompany, insertMachine, migratedTestDb } from '../fixtures/rows.ts';

/**
 * Contacts (migration 0039, 2026-11-14): a company's people outside it, one per Slack workspace and person, with their
 * limits; a Slack message's turn names its sender, the visible text, its contact and its reply's link, only on a turn
 * Most Wanted queued; a Slack conversation's chat names the contact who started it; a decision names its contact, which
 * lets go of it when the contact goes; never another company's contact. Then the migration itself: rows from before keep their values, with no sender or contact.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let agent: Agent;
let chat: Chat;
let seq = 0;
let user = 0;

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;
const seen = new Date(Date.UTC(2026, 10, 14, 9));

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
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

const insertContact = (values: Partial<NewContact> = {}) =>
  handle.db
    .insert(contacts)
    .values({
      companyId: acme.id,
      source: 'slack',
      name: 'Erich Stuntebeck',
      slackTeamId: 'T0AIRIA',
      slackUserId: `U0ERICH${++user}`,
      firstSeenAt: seen,
      lastSeenAt: seen,
      ...values,
    })
    .returning();

async function contact(values: Partial<NewContact> = {}): Promise<Contact> {
  const [row] = await insertContact(values);
  return row as Contact;
}

const turn = (values: Partial<NewChatTurn>) =>
  handle.db
    .insert(chatTurns)
    .values({
      companyId: acme.id,
      chatId: chat.id,
      seq: ++seq,
      prompt: 'Slack message from Erich Stuntebeck in a DM with you. Your final reply is posted there.\n\nHi',
      system: true,
      createdBy: agent.principalId,
      ...values,
    })
    .returning();

const SENDER = {
  via: 'slack',
  userId: 'U0ERICH',
  name: 'Erich Stuntebeck',
  avatarUrl: 'https://avatars.slack-edge.com/erich_72.png',
  link: 'https://airia.slack.com/archives/D0DM/p1731490000000100',
} as const;

describe('contacts', () => {
  it('keeps a Slack person with no note, never archived, and only once per company, workspace and person', async () => {
    const row = await contact({ slackUserId: 'U0ONCE' });
    expect(row).toMatchObject({ note: null, archivedAt: null, email: null, title: null, handle: null });
    expect(await constraint(insertContact({ slackUserId: 'U0ONCE' }))).toBe('contacts_slack_unique');
    await contact({ slackUserId: 'U0ONCE', slackTeamId: 'T0OTHER' });
    await contact({ slackUserId: 'U0ONCE', companyId: globex.id });
  });

  it('checks the source, the Slack ids, the limits and the times', async () => {
    expect(await constraint(insertContact({ source: 'email' as never }))).toBe('contacts_source_check');
    expect(await constraint(insertContact({ slackTeamId: null }))).toBe('contacts_slack_check');
    expect(await constraint(insertContact({ slackUserId: '' }))).toBe('contacts_slack_user_check');
    expect(await constraint(insertContact({ slackTeamId: 'T'.repeat(41) }))).toBe(
      'contacts_slack_team_check',
    );
    expect(await constraint(insertContact({ name: '' }))).toBe('contacts_name_check');
    expect(await constraint(insertContact({ name: 'x'.repeat(121) }))).toBe('contacts_name_check');
    expect(await constraint(insertContact({ avatarUrl: '' }))).toBe('contacts_avatar_check');
    expect(await constraint(insertContact({ email: 'a' }))).toBe('contacts_email_check');
    expect(await constraint(insertContact({ title: '' }))).toBe('contacts_title_check');
    expect(await constraint(insertContact({ handle: 'h'.repeat(81) }))).toBe('contacts_handle_check');
    expect(await constraint(insertContact({ note: 'n'.repeat(2001) }))).toBe('contacts_note_check');
    const before = new Date(seen.getTime() - 1000);
    expect(await constraint(insertContact({ lastSeenAt: before }))).toBe('contacts_seen_check');
  });
});

describe('chat_turns: a Slack message’s turn (0039)', () => {
  it('names its sender, the visible text, its contact and where its reply was posted', async () => {
    const erich = await contact();
    const [row] = await turn({
      sender: SENDER,
      visibleText: 'Hi',
      contactId: erich.id,
      replyLink: 'https://airia.slack.com/archives/D0DM/p1731490000000200',
    });
    expect(row).toMatchObject({ sender: SENDER, visibleText: 'Hi', contactId: erich.id });
  });

  it('takes a sender and a visible text only on a turn Most Wanted queued, and a contact only with a sender', async () => {
    const erich = await contact();
    expect(await constraint(turn({ sender: SENDER, system: false }))).toBe('chat_turns_sender_check');
    expect(await constraint(turn({ sender: [] as never }))).toBe('chat_turns_sender_check');
    expect(await constraint(turn({ contactId: erich.id }))).toBe('chat_turns_contact_check');
    expect(await constraint(turn({ visibleText: 'Hi', system: false }))).toBe(
      'chat_turns_visible_text_check',
    );
    expect(await constraint(turn({ visibleText: 'x'.repeat(20_001) }))).toBe('chat_turns_visible_text_check');
    expect(await constraint(turn({ replyLink: '' }))).toBe('chat_turns_reply_link_check');
  });

  it('never names another company’s contact', async () => {
    const other = await contact({ companyId: globex.id });
    expect(await constraint(turn({ sender: SENDER, contactId: other.id }))).toBe('chat_turns_contact_fk');
  });
});

describe('slack_threads: the contact who started it (0039)', () => {
  it('names a contact of its company, never another’s', async () => {
    const erich = await contact();
    const thread = {
      companyId: acme.id,
      agentId: agent.id,
      chatId: chat.id,
      credentialId: newId(),
      channelId: 'D0DM',
      place: 'a DM',
    };
    const other = await contact({ companyId: globex.id });
    expect(await constraint(handle.db.insert(slackThreads).values({ ...thread, contactId: other.id }))).toBe(
      'slack_threads_contact_fk',
    );
    const [row] = await handle.db
      .insert(slackThreads)
      .values({ ...thread, contactId: erich.id })
      .returning();
    expect(row?.contactId).toBe(erich.id);
  });
});

describe('decisions: the contact the conversation is with (0039)', () => {
  const decision = async (contactId: string, companyId = acme.id) => {
    const [row] = await turn({});
    return handle.db
      .insert(decisions)
      .values({
        companyId,
        agentId: agent.id,
        chatId: chat.id,
        turnId: row?.id as string,
        contactId,
        what: 'Restart the deploy',
        why: 'Erich asked for it',
      })
      .returning();
  };

  it('names a contact of its company, never another’s', async () => {
    const other = await contact({ companyId: globex.id });
    expect(await constraint(decision(other.id))).toBe('decisions_contact_fk');
  });

  it('keeps the decision, without its contact, when the contact goes', async () => {
    const erich = await contact();
    const [made] = await decision(erich.id);
    await handle.db.delete(contacts).where(eq(contacts.id, erich.id));
    const [kept] = await handle.db
      .select()
      .from(decisions)
      .where(eq(decisions.id, made?.id as string));
    expect(kept).toMatchObject({ companyId: acme.id, contactId: null, what: 'Restart the deploy' });
  });
});

describe(`0039_contacts on ${testDbKind()}: rows from before`, () => {
  let old: TestDb;
  const ids = { turn: newId(), thread: newId() };

  beforeAll(async () => {
    old = await createTestDb();
    const h = old.handle;
    await migrateUpTo(h, '0038_decisions');
    const company = await insertCompany(h);
    const bot = await insertAgent(h, company.id);
    const machine = await insertMachine(h, company.id);
    const chatId = newId();
    // Written with the columns the tables had at `0038` (this migration adds its own, which drizzle would name).
    await queryRows(
      h,
      sql`insert into chats (id, company_id, agent_id, harness, machine_id, created_by)
          values (${chatId}, ${company.id}, ${bot.id}, 'claude_code', ${machine.id}, ${bot.principalId})`,
    );
    await queryRows(
      h,
      sql`insert into chat_turns (id, company_id, chat_id, seq, prompt, status, system, created_by)
          values (${ids.turn}, ${company.id}, ${chatId}, 1, 'Slack message from Erich in a DM with you. Hi', 'done',
                  true, ${bot.principalId})`,
    );
    await queryRows(
      h,
      sql`insert into slack_threads (id, company_id, agent_id, chat_id, credential_id, channel_id, place)
          values (${ids.thread}, ${company.id}, ${bot.id}, ${chatId}, ${newId()}, 'D0DM', 'a DM')`,
    );
    await migrateToLatest(h);
  });
  afterAll(() => old.close());

  it('keeps them as they were, with no sender, visible text, contact or reply link', async () => {
    const [row] = await old.handle.db.select().from(chatTurns).where(eq(chatTurns.id, ids.turn));
    expect(row).toMatchObject({
      system: true,
      sender: null,
      visibleText: null,
      contactId: null,
      replyLink: null,
    });
    const [thread] = await old.handle.db.select().from(slackThreads).where(eq(slackThreads.id, ids.thread));
    expect(thread).toMatchObject({ place: 'a DM', contactId: null });
    expect(await old.handle.db.select().from(contacts)).toEqual([]);
  });
});
