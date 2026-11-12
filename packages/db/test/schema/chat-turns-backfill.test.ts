import { newId } from '@mwc/shared/ids';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest } from '../../src/migrate.ts';
import { type Chat, chats, chatTurns } from '../../src/schema/index.ts';
import { createTestDb, pgError, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import { insertAgentBefore0030, insertCompany, insertMachine } from '../fixtures/rows.ts';

/**
 * The data step of migration `0028_chat_slot_waits` (the `-- custom:` part of `migrations/0028_chat_slot_waits.sql`): a
 * turn now waits for its machine to start (`stopped`) or for a free slot (`slots`), and `machine_wait` says which; every
 * turn that waited before it waited for its stopped machine. The rows are seeded at `0027_lead_check_ins`, with the
 * columns `chat_turns` had then.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let chat: Chat;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0027_lead_check_ins');
  const company = await insertCompany(handle);
  const agent = await insertAgentBefore0030(handle, company.id);
  const machine = await insertMachine(handle, company.id);
  const [row] = await handle.db
    .insert(chats)
    .values({
      companyId: company.id,
      agentId: agent.id,
      harness: 'claude_code',
      machineId: machine.id,
      createdBy: agent.principalId,
    })
    .returning();
  chat = row as Chat;
});
afterAll(() => testDb.close());

/** A turn written with the columns `chat_turns` had at `0027`. */
async function turnAt0027(seq: number, machineWaitAt: Date | null): Promise<string> {
  const id = newId();
  const at = machineWaitAt?.toISOString() ?? null;
  await queryRows(
    handle,
    sql`insert into chat_turns (id, company_id, chat_id, seq, prompt, status, machine_wait_at, created_by)
        values (${id}, ${chat.companyId}, ${chat.id}, ${seq}, 'Hello', 'failed', ${at}::timestamptz, ${chat.createdBy})`,
  );
  return id;
}

describe(`0028_chat_slot_waits on ${testDbKind()}: what a turn waits for on its machine`, () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ids.waited = await turnAt0027(1, new Date(Date.UTC(2026, 10, 12, 9)));
    ids.plain = await turnAt0027(2, null);
    await migrateToLatest(handle);
  });

  const waitOf = async (id: string | undefined) => {
    const [row] = await handle.db
      .select()
      .from(chatTurns)
      .where(eq(chatTurns.id, id as string));
    return row?.machineWait;
  };

  it('says a turn that waited waited for its stopped machine, and nothing of the others', async () => {
    expect(await waitOf(ids.waited)).toBe('stopped');
    expect(await waitOf(ids.plain)).toBeNull();
  });

  it('refuses an unknown wait, and a wait without its time', async () => {
    const base = { companyId: chat.companyId, chatId: chat.id, prompt: 'Hi', createdBy: chat.createdBy };
    const insert = (values: Partial<typeof chatTurns.$inferInsert>) =>
      handle.db.insert(chatTurns).values({ ...base, seq: 10, ...values });
    expect(
      (await pgError(insert({ machineWait: 'slot' as never, machineWaitAt: new Date() }))).constraint,
    ).toBe('chat_turns_machine_wait_check');
    expect((await pgError(insert({ machineWait: 'slots' }))).constraint).toBe(
      'chat_turns_machine_wait_at_check',
    );
    const [row] = await insert({ machineWait: 'slots', machineWaitAt: new Date() }).returning();
    expect(row?.machineWait).toBe('slots');
  });
});
