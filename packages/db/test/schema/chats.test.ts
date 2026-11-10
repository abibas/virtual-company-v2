import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Agent,
  accessProfiles,
  type Chat,
  type ChatTurn,
  type Company,
  chatEvents,
  chats,
  chatTurns,
  type Machine,
  type NewChat,
  type NewChatTurn,
  type Principal,
  type User,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertMachine,
  insertMember,
  MISSING_ID,
  migratedTestDb,
  unique,
} from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let agent: Agent;
let mac: Machine;
let owner: { user: User; principal: Principal };

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  agent = await insertAgent(handle, acme.id);
  mac = await insertMachine(handle, acme.id);
  owner = await insertMember(handle, acme.id, { role: 'owner', grantedRole: 'owner' });
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

async function insertChat(values: Partial<NewChat> = {}): Promise<Chat> {
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: acme.id,
      agentId: agent.id,
      harness: 'claude_code',
      machineId: mac.id,
      createdBy: owner.principal.id,
      ...values,
    })
    .returning();
  if (!row) throw new Error('no chat returned');
  return row;
}

async function insertTurn(chat: Chat, values: Partial<NewChatTurn> = {}): Promise<ChatTurn> {
  const [row] = await handle.db
    .insert(chatTurns)
    .values({
      companyId: chat.companyId,
      chatId: chat.id,
      seq: 1,
      prompt: 'What is 2 + 2?',
      createdBy: owner.principal.id,
      ...values,
    })
    .returning();
  if (!row) throw new Error('no turn returned');
  return row;
}

describe('chats', () => {
  it('stores a new chat with no title, session or profile of its own', async () => {
    expect(await insertChat()).toMatchObject({
      harness: 'claude_code',
      profileId: null,
      profileSetBy: null,
      sessionId: null,
      title: null,
      archivedAt: null,
    });
  });

  it('refuses another harness, a bad title or session id, and a profile without who set it', async () => {
    expect(await constraint(insertChat({ harness: 'cursor' as never }))).toBe('chats_harness_check');
    expect(await constraint(insertChat({ title: '' }))).toBe('chats_title_check');
    expect(await constraint(insertChat({ title: 't'.repeat(81) }))).toBe('chats_title_check');
    expect(await constraint(insertChat({ sessionId: '' }))).toBe('chats_session_id_check');
    const [profile] = await handle.db
      .insert(accessProfiles)
      .values({ ownerUserId: owner.user.id, name: unique('profile'), provider: 'claude' })
      .returning();
    const profileId = profile?.id as string;
    expect(await constraint(insertChat({ profileId }))).toBe('chats_profile_set_by_check');
    const chat = await insertChat({ profileId, profileSetBy: owner.user.id });
    // Removing the profile empties the chat's choice and keeps who set it.
    await handle.db.delete(accessProfiles).where(eq(accessProfiles.id, profileId));
    const [after] = await handle.db.select().from(chats).where(eq(chats.id, chat.id));
    expect(after).toMatchObject({ profileId: null, profileSetBy: owner.user.id });
  });

  it("refuses another company's agent, machine or principal (composite keys)", async () => {
    const theirs = await insertAgent(handle, globex.id);
    const theirMachine = await insertMachine(handle, globex.id);
    expect(await constraint(insertChat({ agentId: theirs.id }))).toBe('chats_agent_fk');
    expect(await constraint(insertChat({ machineId: theirMachine.id }))).toBe('chats_machine_fk');
    expect(await constraint(insertChat({ createdBy: MISSING_ID }))).toBe('chats_created_by_fk');
  });
});

describe('chats: branches (0018)', () => {
  it('names the parent chat and turn, and stays pending until forked only with a session', async () => {
    const parent = await insertChat({ sessionId: 'parent-session' });
    const turn = await insertTurn(parent, { status: 'done' });
    expect(await insertChat()).toMatchObject({
      branchedFromChatId: null,
      branchedFromTurnId: null,
      forkPending: false,
    });
    const branch = { branchedFromChatId: parent.id, branchedFromTurnId: turn.id };
    expect(await insertChat({ ...branch, sessionId: 'parent-session', forkPending: true })).toMatchObject({
      ...branch,
      forkPending: true,
    });
    expect(await constraint(insertChat({ branchedFromTurnId: turn.id }))).toBe('chats_branch_check');
    expect(await constraint(insertChat({ ...branch, forkPending: true }))).toBe('chats_fork_pending_check');
  });

  it("refuses another company's chat or turn as the parent (composite keys)", async () => {
    const theirAgent = await insertAgent(handle, globex.id);
    const theirMachine = await insertMachine(handle, globex.id);
    const them = await insertMember(handle, globex.id, { role: 'owner', grantedRole: 'owner' });
    const [theirs] = await handle.db
      .insert(chats)
      .values({
        companyId: globex.id,
        agentId: theirAgent.id,
        harness: 'claude_code',
        machineId: theirMachine.id,
        createdBy: them.principal.id,
      })
      .returning();
    const theirChat = theirs as Chat;
    const theirTurn = await insertTurn(theirChat, { createdBy: them.principal.id });
    expect(await constraint(insertChat({ branchedFromChatId: theirChat.id }))).toBe(
      'chats_branched_from_chat_fk',
    );
    const mine = await insertChat();
    expect(
      await constraint(insertChat({ branchedFromChatId: mine.id, branchedFromTurnId: theirTurn.id })),
    ).toBe('chats_branched_from_turn_fk');
  });

  it('forgets only the parent turn, then only the parent chat, when they go (SET NULL of one column)', async () => {
    const parent = await insertChat();
    const turn = await insertTurn(parent, { status: 'done' });
    const branch = await insertChat({ branchedFromChatId: parent.id, branchedFromTurnId: turn.id });
    const read = async () => (await handle.db.select().from(chats).where(eq(chats.id, branch.id)))[0];
    await handle.db.delete(chatTurns).where(eq(chatTurns.id, turn.id));
    expect(await read()).toMatchObject({
      companyId: acme.id,
      branchedFromChatId: parent.id,
      branchedFromTurnId: null,
    });
    await handle.db.delete(chats).where(eq(chats.id, parent.id));
    expect(await read()).toMatchObject({ companyId: acme.id, branchedFromChatId: null });
  });
});

describe('chat_turns', () => {
  it('numbers the turns of a chat once each, and keeps one running at a time with any number queued', async () => {
    const chat = await insertChat();
    const first = await insertTurn(chat, { status: 'running' });
    expect(first).toMatchObject({ status: 'running', resultText: null, usage: null, delivery: null });
    expect(await constraint(insertTurn(chat, { seq: 1, status: 'done' }))).toBe('chat_turns_chat_seq_unique');
    expect(await constraint(insertTurn(chat, { seq: 2, status: 'running' }))).toBe(
      'chat_turns_one_running_idx',
    );
    expect(await insertTurn(chat, { seq: 2, delivery: 'after' })).toMatchObject({ status: 'queued' });
    expect(await insertTurn(chat, { seq: 3, delivery: 'interrupt' })).toMatchObject({ status: 'queued' });
    await handle.db.update(chatTurns).set({ status: 'done' }).where(eq(chatTurns.id, first.id));
    expect(await insertTurn(chat, { seq: 4, status: 'running', delivery: 'now' })).toMatchObject({
      status: 'running',
      delivery: 'now',
    });
    const other = await insertChat();
    expect(await insertTurn(other, { status: 'running' })).toMatchObject({ status: 'running' });
  });

  it('takes only the known deliveries', async () => {
    const chat = await insertChat();
    expect(await constraint(insertTurn(chat, { delivery: 'later' as never }))).toBe(
      'chat_turns_delivery_check',
    );
  });

  it('refuses a bad status, seq, prompt or usage, and another company’s chat', async () => {
    const chat = await insertChat();
    expect(await constraint(insertTurn(chat, { status: 'lost' as never }))).toBe('chat_turns_status_check');
    expect(await constraint(insertTurn(chat, { seq: 0 }))).toBe('chat_turns_seq_check');
    expect(await constraint(insertTurn(chat, { prompt: '' }))).toBe('chat_turns_prompt_check');
    expect(await constraint(insertTurn(chat, { prompt: 'p'.repeat(20_001) }))).toBe(
      'chat_turns_prompt_check',
    );
    expect(await constraint(insertTurn(chat, { usage: [1] as never }))).toBe('chat_turns_usage_check');
    expect(await constraint(insertTurn({ ...chat, companyId: globex.id }))).toBe('chat_turns_chat_fk');
  });

  it('is a message by default, takes a compact, and a clear only done and on no credential', async () => {
    const chat = await insertChat();
    expect(await insertTurn(chat, { status: 'done' })).toMatchObject({ kind: 'message' });
    expect(
      await insertTurn(chat, { seq: 2, kind: 'compact', prompt: '/compact', status: 'done' }),
    ).toMatchObject({
      kind: 'compact',
    });
    expect(await constraint(insertTurn(chat, { seq: 3, kind: 'reset' as never }))).toBe(
      'chat_turns_kind_check',
    );
    const clear = { seq: 3, kind: 'clear', prompt: '/clear' } as const;
    expect(await constraint(insertTurn(chat, { ...clear, status: 'running' }))).toBe(
      'chat_turns_clear_check',
    );
    expect(await constraint(insertTurn(chat, { ...clear, status: 'done', credentialId: MISSING_ID }))).toBe(
      'chat_turns_clear_check',
    );
    expect(await insertTurn(chat, { ...clear, status: 'done' })).toMatchObject({
      kind: 'clear',
      status: 'done',
    });
  });
});

describe('chat_events', () => {
  it('keeps each event of a turn once, by its seq', async () => {
    const turn = await insertTurn(await insertChat());
    const event = (seq: number) => ({
      companyId: acme.id,
      turnId: turn.id,
      seq,
      event: { type: 'text', text: `part ${seq}` },
    });
    await handle.db.insert(chatEvents).values([event(1), event(2)]);
    expect(await constraint(handle.db.insert(chatEvents).values(event(1)))).toBe(
      'chat_events_company_id_turn_id_seq_pk',
    );
    await handle.db.insert(chatEvents).values(event(2)).onConflictDoNothing();
    const rows = await handle.db.select().from(chatEvents).where(eq(chatEvents.turnId, turn.id));
    expect(rows.map((row) => row.seq).sort()).toEqual([1, 2]);
  });

  it('refuses a bad seq, an event that is not an object, and another company’s turn', async () => {
    const turn = await insertTurn(await insertChat());
    const base = { companyId: acme.id, turnId: turn.id, seq: 1, event: { type: 'text', text: 'x' } };
    expect(await constraint(handle.db.insert(chatEvents).values({ ...base, seq: 0 }))).toBe(
      'chat_events_seq_check',
    );
    expect(await constraint(handle.db.insert(chatEvents).values({ ...base, event: [1] as never }))).toBe(
      'chat_events_event_check',
    );
    expect(await constraint(handle.db.insert(chatEvents).values({ ...base, companyId: globex.id }))).toBe(
      'chat_events_turn_fk',
    );
  });
});
