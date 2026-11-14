import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Agent,
  type Chat,
  type ChatTurn,
  type Company,
  chats,
  chatTurns,
  decisions,
  flows,
  type NewDecision,
  type Task,
  tasks,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertAgent, insertCompany, insertMachine, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

/** The decision log (migration 0038): its CHECKs, its tenant keys, and a contact id with no foreign key yet. */

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let agent: Agent;
let chat: Chat;
let turn: ChatTurn;
let task: Task;
let theirs: { agent: Agent; chat: Chat; turn: ChatTurn; task: Task };

async function scene(company: Company) {
  const who = await insertAgent(handle, company.id);
  const machine = await insertMachine(handle, company.id);
  const [flow] = await handle.db
    .insert(flows)
    .values({
      companyId: company.id,
      leadPrincipalId: who.principalId,
      name: 'F',
      createdBy: who.principalId,
    })
    .returning();
  const [made] = await handle.db
    .insert(tasks)
    .values({
      companyId: company.id,
      number: 1,
      flowId: flow?.id as string,
      title: 'T',
      createdBy: who.principalId,
    })
    .returning();
  const [conversation] = await handle.db
    .insert(chats)
    .values({
      companyId: company.id,
      agentId: who.id,
      harness: 'claude_code',
      machineId: machine.id,
      createdBy: who.principalId,
    })
    .returning();
  const [first] = await handle.db
    .insert(chatTurns)
    .values({
      companyId: company.id,
      chatId: conversation?.id as string,
      seq: 1,
      prompt: 'Review it',
      createdBy: who.principalId,
    })
    .returning();
  return { agent: who, chat: conversation as Chat, turn: first as ChatTurn, task: made as Task };
}

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  ({ agent, chat, turn, task } = await scene(acme));
  theirs = await scene(globex);
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

const record = (values: Partial<NewDecision> = {}) =>
  handle.db
    .insert(decisions)
    .values({
      companyId: acme.id,
      agentId: agent.id,
      chatId: chat.id,
      turnId: turn.id,
      what: 'Approve PR #12',
      why: 'The tests pass.',
      ...values,
    })
    .returning();

describe('decisions (0038)', () => {
  it('keeps a decision with its links, its sources and its outcome; the optional parts default to none', async () => {
    const [bare] = await record();
    expect(bare).toMatchObject({ taskId: null, contactId: null, sources: [], outcome: null, eventSeq: null });
    const sources = ['https://github.com/acme/app/pull/12', 'SS-2887'];
    const [full] = await record({ taskId: task.id, sources, outcome: 'approved', eventSeq: 7 });
    expect(full).toMatchObject({ taskId: task.id, sources, outcome: 'approved', eventSeq: 7 });
  });

  it('takes any contact id: no foreign key until the contacts table lands', async () => {
    const [row] = await record({ contactId: MISSING_ID });
    expect(row?.contactId).toBe(MISSING_ID);
  });

  it('refuses parts out of bounds, sources that are not a short list, an unknown outcome and a negative event', async () => {
    expect(await constraint(record({ what: '' }))).toBe('decisions_what_check');
    expect(await constraint(record({ what: 'x'.repeat(201) }))).toBe('decisions_what_check');
    expect(await constraint(record({ why: '' }))).toBe('decisions_why_check');
    expect(await constraint(record({ why: 'y'.repeat(1001) }))).toBe('decisions_why_check');
    expect(await constraint(record({ sources: {} as never }))).toBe('decisions_sources_check');
    const many = Array.from({ length: 21 }, (_, i) => `s${i}`);
    expect(await constraint(record({ sources: many }))).toBe('decisions_sources_check');
    expect(await constraint(record({ outcome: 'maybe' as never }))).toBe('decisions_outcome_check');
    expect(await constraint(record({ eventSeq: -1 }))).toBe('decisions_event_seq_check');
  });

  it('refuses another company’s agent, chat, turn and task', async () => {
    expect(await constraint(record({ agentId: theirs.agent.id }))).toBe('decisions_agent_fk');
    expect(await constraint(record({ chatId: theirs.chat.id }))).toBe('decisions_chat_fk');
    expect(await constraint(record({ turnId: theirs.turn.id }))).toBe('decisions_turn_fk');
    expect(await constraint(record({ taskId: theirs.task.id }))).toBe('decisions_task_fk');
  });
});
