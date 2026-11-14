import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Chat,
  type Company,
  type Contact,
  chatParticipants,
  chats,
  chatTurns,
  contacts,
  type NewChatParticipant,
  type NewChatTurn,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertAgent, insertCompany, insertMachine, insertMember, migratedTestDb } from '../fixtures/rows.ts';

/**
 * Who is in a chat (migration 0040, 2026-11-14): a member or a contact per row, never both nor neither, once per chat,
 * never another company's chat, person or contact; and the turns that run no process (`people`, `slack`), always done on
 * no credential, with a person's own text kept beside a prompt that names them.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let chat: Chat;
let person: string;
let contact: Contact;
let seq = 0;

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  const agent = await insertAgent(handle, acme.id);
  const mac = await insertMachine(handle, acme.id);
  person = (await insertMember(handle, acme.id)).principal.id;
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: acme.id,
      agentId: agent.id,
      harness: 'claude_code',
      machineId: mac.id,
      createdBy: person,
    })
    .returning();
  chat = row as Chat;
  const seen = new Date(Date.UTC(2026, 10, 14, 9));
  const [found] = await handle.db
    .insert(contacts)
    .values({
      companyId: acme.id,
      source: 'slack',
      name: 'Erich',
      slackTeamId: 'T0AIRIA',
      slackUserId: 'U0ERICH',
      firstSeenAt: seen,
      lastSeenAt: seen,
    })
    .returning();
  contact = found as Contact;
});
afterAll(() => testDb.close());

const add = (values: Partial<NewChatParticipant>) =>
  handle.db
    .insert(chatParticipants)
    .values({ companyId: acme.id, chatId: chat.id, ...values })
    .returning();

describe('chat_participants', () => {
  it('holds a member or a contact, once each per chat, with who added them and when', async () => {
    const [member] = await add({ principalId: person, addedBy: person });
    expect(member).toMatchObject({ principalId: person, contactId: null, addedBy: person });
    expect(member?.addedAt).toBeInstanceOf(Date);
    const [outside] = await add({ contactId: contact.id });
    expect(outside).toMatchObject({ principalId: null, contactId: contact.id, addedBy: null });
    expect(await constraint(add({ principalId: person }))).toBe('chat_participants_principal_unique');
    expect(await constraint(add({ contactId: contact.id }))).toBe('chat_participants_contact_unique');
  });

  it('refuses a row naming both a member and a contact, or neither', async () => {
    const other = (await insertMember(handle, acme.id)).principal.id;
    expect(await constraint(add({ principalId: other, contactId: contact.id }))).toBe(
      'chat_participants_who_check',
    );
    expect(await constraint(add({}))).toBe('chat_participants_who_check');
  });

  it("never names another company's chat, person, contact or adder", async () => {
    const stranger = (await insertMember(handle, globex.id)).principal.id;
    expect(await constraint(add({ principalId: stranger }))).toBe('chat_participants_principal_fk');
    const local = (await insertMember(handle, acme.id)).principal.id;
    expect(await constraint(add({ principalId: local, addedBy: stranger }))).toBe(
      'chat_participants_added_by_fk',
    );
    const elsewhere = handle.db
      .insert(chatParticipants)
      .values({ companyId: globex.id, chatId: chat.id, principalId: stranger });
    expect(await constraint(elsewhere)).toBe('chat_participants_chat_fk');
    const theirs = handle.db
      .insert(chatParticipants)
      .values({ companyId: acme.id, chatId: chat.id, contactId: globex.id });
    expect(await constraint(theirs)).toBe('chat_participants_contact_fk');
  });
});

const turn = (values: Partial<NewChatTurn>) =>
  handle.db
    .insert(chatTurns)
    .values({
      companyId: acme.id,
      chatId: chat.id,
      seq: ++seq,
      prompt: 'Ihor added Anna',
      createdBy: person,
      ...values,
    })
    .returning();

describe('chat_turns that run no process (0040)', () => {
  it('takes a people line and a message sent in Slack, done on no credential', async () => {
    const [line] = await turn({ kind: 'people', status: 'done' });
    expect(line?.kind).toBe('people');
    const link = 'https://airia.slack.com/archives/D1/p1';
    const [sent] = await turn({ kind: 'slack', status: 'done', prompt: 'On my way', replyLink: link });
    expect(sent).toMatchObject({ kind: 'slack', replyLink: link });
  });

  it('refuses one that is not done, or names a credential', async () => {
    expect(await constraint(turn({ kind: 'people', status: 'running' }))).toBe('chat_turns_note_check');
    const credentialId = '0190f5f0-0000-7000-8000-000000000001';
    expect(await constraint(turn({ kind: 'slack', status: 'done', credentialId }))).toBe(
      'chat_turns_note_check',
    );
    expect(await constraint(turn({ kind: 'mention' as never, status: 'done' }))).toBe(
      'chat_turns_kind_check',
    );
  });

  it("keeps a person's own text beside a prompt that names them, on a message only", async () => {
    const [written] = await turn({ prompt: 'Message from Ihor:\n\nHi', visibleText: 'Hi', status: 'done' });
    expect(written).toMatchObject({ system: false, visibleText: 'Hi' });
    expect(await constraint(turn({ kind: 'people', status: 'done', visibleText: 'Hi' }))).toBe(
      'chat_turns_visible_text_check',
    );
  });
});
