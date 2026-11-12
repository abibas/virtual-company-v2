import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Agent,
  type Chat,
  type Company,
  chats,
  chatTurns,
  type Flow,
  flows,
  type NewRoomMessage,
  type Principal,
  roomMessages,
  type Task,
  tasks,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertMachine,
  insertPrincipal,
  MISSING_ID,
  migratedTestDb,
} from '../fixtures/rows.ts';

/** The team room (migration 0031): its messages' CHECKs and keys, a room turn's message, and the flow's cap. */

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let lead: Agent;
let person: Principal;
let flow: Flow;
let task: Task;
let chat: Chat;
let theirTask: Task;

async function flowOf(company: Company, leadPrincipal: string): Promise<Flow> {
  const [row] = await handle.db
    .insert(flows)
    .values({
      companyId: company.id,
      leadPrincipalId: leadPrincipal,
      name: 'Delivery',
      createdBy: leadPrincipal,
    })
    .returning();
  return row as Flow;
}

async function taskOf(company: Company, of: Flow): Promise<Task> {
  const [row] = await handle.db
    .insert(tasks)
    .values({ companyId: company.id, number: 1, flowId: of.id, title: 'T', createdBy: of.leadPrincipalId })
    .returning();
  return row as Task;
}

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  lead = await insertAgent(handle, acme.id);
  person = await insertPrincipal(handle, acme.id);
  const mac = await insertMachine(handle, acme.id);
  flow = await flowOf(acme, lead.principalId);
  task = await taskOf(acme, flow);
  theirTask = await taskOf(globex, await flowOf(globex, (await insertPrincipal(handle, globex.id)).id));
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: acme.id,
      agentId: lead.id,
      harness: 'claude_code',
      machineId: mac.id,
      flowId: flow.id,
      createdBy: lead.principalId,
    })
    .returning();
  chat = row as Chat;
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

const post = (values: Partial<NewRoomMessage> = {}) =>
  handle.db
    .insert(roomMessages)
    .values({
      companyId: acme.id,
      flowId: flow.id,
      kind: 'message',
      authorPrincipalId: person.id,
      body: 'Ship it?',
      ...values,
    })
    .returning();

describe('room_messages (0031)', () => {
  it('keeps a person’s message, a step-end line, a reply in its turn and a notice of no one', async () => {
    const [message] = await post({ asked: 3 });
    expect(message).toMatchObject({ kind: 'message', asked: 3, details: {}, taskId: null });
    const details = { action: 'hand_on', from: 'Develop', to: 'Code review', round: 1 };
    const [line] = await post({
      kind: 'step_end',
      authorPrincipalId: lead.principalId,
      taskId: task.id,
      details,
    });
    expect(line?.details).toEqual(details);
    const [reply] = await post({
      kind: 'reply',
      authorPrincipalId: lead.principalId,
      chatId: chat.id,
      turnId: MISSING_ID,
    });
    expect(reply?.turnId).toBe(MISSING_ID);
    const [notice] = await post({ kind: 'notice', authorPrincipalId: null, body: 'Most Wanted · check-in' });
    expect(notice?.authorPrincipalId).toBeNull();
  });

  it('refuses an unknown kind, a notice with an author or a message without one, and bodies out of bounds', async () => {
    expect(await constraint(post({ kind: 'shout' as never }))).toBe('room_messages_kind_check');
    expect(await constraint(post({ kind: 'notice' }))).toBe('room_messages_author_check');
    expect(await constraint(post({ authorPrincipalId: null }))).toBe('room_messages_author_check');
    expect(await constraint(post({ body: '' }))).toBe('room_messages_body_check');
    expect(await constraint(post({ body: 'x'.repeat(20_001) }))).toBe('room_messages_body_check');
  });

  it('refuses a step-end line of no task, a count on anything but a message, odd details and a turn of no chat', async () => {
    expect(await constraint(post({ kind: 'step_end' }))).toBe('room_messages_step_end_check');
    expect(await constraint(post({ kind: 'reply', asked: 1 }))).toBe('room_messages_asked_check');
    expect(await constraint(post({ asked: -1 }))).toBe('room_messages_asked_check');
    expect(await constraint(post({ details: [] as never }))).toBe('room_messages_details_check');
    expect(await constraint(post({ turnId: MISSING_ID }))).toBe('room_messages_turn_check');
  });

  it('refuses another company’s flow, author and task', async () => {
    expect(await constraint(post({ companyId: globex.id }))).toBe('room_messages_flow_fk');
    const theirs = await insertPrincipal(handle, globex.id);
    expect(await constraint(post({ authorPrincipalId: theirs.id }))).toBe('room_messages_author_fk');
    expect(await constraint(post({ kind: 'step_end', taskId: theirTask.id }))).toBe('room_messages_task_fk');
  });
});

describe('a room turn and the flow’s cap (0031)', () => {
  it('names the room message a system turn answers, and only a system turn', async () => {
    const [message] = await post();
    const base = { companyId: acme.id, chatId: chat.id, prompt: 'Room', createdBy: lead.principalId };
    const [turn] = await handle.db
      .insert(chatTurns)
      .values({ ...base, seq: 1, system: true, roomMessageId: message?.id })
      .returning();
    expect(turn?.roomMessageId).toBe(message?.id);
    expect(
      await constraint(handle.db.insert(chatTurns).values({ ...base, seq: 2, roomMessageId: message?.id })),
    ).toBe('chat_turns_room_message_check');
    expect(
      await constraint(
        handle.db.insert(chatTurns).values({ ...base, seq: 3, system: true, roomMessageId: MISSING_ID }),
      ),
    ).toBe('chat_turns_room_message_fk');
  });

  it('caps a room at 30 answers an hour by default, from 1 to 200', async () => {
    expect(flow.roomMaxPerHour).toBe(30);
    const other = await insertPrincipal(handle, acme.id);
    const insert = (roomMaxPerHour: number) =>
      handle.db
        .insert(flows)
        .values({
          companyId: acme.id,
          leadPrincipalId: other.id,
          name: 'F',
          createdBy: other.id,
          roomMaxPerHour,
        });
    expect(await constraint(insert(0))).toBe('flows_room_per_hour_check');
    expect(await constraint(insert(201))).toBe('flows_room_per_hour_check');
    await insert(200);
  });
});
