import { newId } from '@mwc/shared/ids';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import { chatTurns, flows, roomMessages } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertAgent, insertCompany, insertMachine, insertPrincipal } from '../fixtures/rows.ts';

/**
 * The data steps of migration `0031_team_room` (the `-- custom:` parts of `migrations/0031_team_room.sql`): a flow's team
 * chat so far starts its team room (people's messages by them, Most Wanted's wake-ups as notices, the Lead's replies
 * that ended done by it, at their times), and a task step's own prompts become Most Wanted's (`system`) while a
 * person's reply in a task's conversation stays theirs. The flow cap's default is 30. Seeded at `0030_tool_profiles`
 * with the columns the tables had then.
 */

let testDb: TestDb;
let handle: RawDbHandle;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 9, minute));

interface Seeded {
  readonly companyId: string;
  readonly flowId: string;
  readonly teamChat: string;
  readonly taskChat: string;
  readonly person: string;
  readonly lead: string;
}
let s: Seeded;

/** A turn written with the columns `chat_turns` had at `0030`. */
async function turnAt0030(
  chat: { readonly companyId: string; readonly id: string },
  values: {
    readonly seq: number;
    readonly prompt: string;
    readonly by: string;
    readonly system?: boolean;
    readonly status?: string;
    readonly reply?: string | null;
    readonly minute: number;
  },
): Promise<string> {
  const id = newId();
  const ended = values.status === 'queued' ? null : at(values.minute + 1).toISOString();
  await queryRows(
    handle,
    sql`insert into chat_turns (id, company_id, chat_id, seq, prompt, status, system, result_text, created_by,
          created_at, ended_at)
        values (${id}, ${chat.companyId}, ${chat.id}, ${values.seq}, ${values.prompt}, ${values.status ?? 'done'},
                ${values.system ?? false}, ${values.reply ?? null}, ${values.by}, ${at(values.minute).toISOString()},
                ${ended}::timestamptz)`,
  );
  return id;
}

async function seed(): Promise<Seeded> {
  const company = await insertCompany(handle);
  const person = (await insertPrincipal(handle, company.id)).id;
  const lead = await insertAgent(handle, company.id);
  const machine = await insertMachine(handle, company.id);
  const flowId = newId();
  await queryRows(
    handle,
    sql`insert into flows (id, company_id, lead_principal_id, name, created_by)
        values (${flowId}, ${company.id}, ${lead.principalId}, 'DEVBOX delivery', ${person})`,
  );
  const taskId = newId();
  await queryRows(
    handle,
    sql`insert into tasks (id, company_id, number, flow_id, title, created_by)
        values (${taskId}, ${company.id}, 12, ${flowId}, 'Fix the login', ${person})`,
  );
  // Written with the columns `chats` had at `0030` (a later migration adds its own, which drizzle would name).
  const chat = async (title: string, task: { readonly flowId?: string; readonly taskId?: string }) => {
    const id = newId();
    const step = task.taskId === undefined ? null : newId();
    const round = task.taskId === undefined ? null : 1;
    await queryRows(
      handle,
      sql`insert into chats (id, company_id, agent_id, harness, machine_id, created_by, title, flow_id, task_id,
            task_step_id, task_round)
          values (${id}, ${company.id}, ${lead.id}, 'claude_code', ${machine.id}, ${lead.principalId}, ${title},
                  ${task.flowId ?? null}, ${task.taskId ?? null}, ${step}, ${round})`,
    );
    return id;
  };
  const team = await chat('DEVBOX delivery: team', { flowId });
  const task = await chat('T-12 · Develop · Fix the login', { taskId });
  return {
    companyId: company.id,
    flowId,
    teamChat: team,
    taskChat: task,
    person,
    lead: lead.principalId,
  };
}

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0030_tool_profiles');
  s = await seed();
});
afterAll(() => testDb.close());

describe(`0031_team_room on ${testDbKind()}: the team chat so far starts the room; step prompts are Most Wanted's`, () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const team = { companyId: s.companyId, id: s.teamChat };
    const task = { companyId: s.companyId, id: s.taskChat };
    const wake = 'Most Wanted · DEVBOX delivery: 1 task needs your decision.';
    ids.wake = await turnAt0030(team, {
      seq: 1,
      prompt: wake,
      by: s.lead,
      system: true,
      reply: 'Routed T-12.',
      minute: 0,
    });
    ids.asked = await turnAt0030(team, { seq: 2, prompt: 'Hold T-14', by: s.person, reply: '  ', minute: 5 });
    ids.failed = await turnAt0030(team, {
      seq: 3,
      prompt: 'And T-15?',
      by: s.person,
      status: 'failed',
      minute: 9,
    });
    ids.waiting = await turnAt0030(team, {
      seq: 4,
      prompt: 'Check-in',
      by: s.lead,
      system: true,
      status: 'queued',
      minute: 20,
    });
    ids.full = await turnAt0030(task, {
      seq: 1,
      prompt: '# T-12 · Fix the login\n\nYou are working…',
      by: s.person,
      minute: 1,
    });
    ids.delta = await turnAt0030(task, {
      seq: 2,
      prompt: 'Task T-12 is back at your step "Develop" (Work): round 2.',
      by: s.person,
      minute: 2,
    });
    ids.again = await turnAt0030(task, {
      seq: 3,
      prompt: 'Continue task T-12 at your step "Develop" (Work), round 1, where you left off.',
      by: s.person,
      minute: 3,
    });
    ids.reply = await turnAt0030(task, {
      seq: 4,
      prompt: 'Use the staging database',
      by: s.person,
      minute: 4,
    });
    await migrateToLatest(handle);
  });

  it('writes every message turn of the team chat into the room, with the replies that ended done', async () => {
    const rows = await handle.db
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.flowId, s.flowId))
      .orderBy(asc(roomMessages.createdAt), asc(roomMessages.id));
    const seen = rows.map((row) => [
      row.kind,
      row.authorPrincipalId,
      row.body,
      row.turnId,
      row.createdAt.getTime(),
    ]);
    expect(seen).toEqual([
      [
        'notice',
        null,
        'Most Wanted · DEVBOX delivery: 1 task needs your decision.',
        ids.wake,
        at(0).getTime(),
      ],
      ['reply', s.lead, 'Routed T-12.', ids.wake, at(1).getTime()],
      ['message', s.person, 'Hold T-14', ids.asked, at(5).getTime()],
      ['message', s.person, 'And T-15?', ids.failed, at(9).getTime()],
      ['notice', null, 'Check-in', ids.waiting, at(20).getTime()],
    ]);
    expect(rows.every((row) => row.chatId === s.teamChat && row.asked === null)).toBe(true);
  });

  it('makes a task step’s own prompts Most Wanted’s, and leaves a person’s reply theirs', async () => {
    const system = async (id: string | undefined) =>
      (
        await handle.db
          .select()
          .from(chatTurns)
          .where(eq(chatTurns.id, id as string))
      )[0]?.system;
    expect(await system(ids.full)).toBe(true);
    expect(await system(ids.delta)).toBe(true);
    expect(await system(ids.again)).toBe(true);
    expect(await system(ids.reply)).toBe(false);
    expect(await system(ids.asked)).toBe(false);
  });

  it('gives every flow the room’s cap of 30 answers an hour', async () => {
    const [flow] = await handle.db.select().from(flows).where(eq(flows.id, s.flowId));
    expect(flow?.roomMaxPerHour).toBe(30);
  });
});
