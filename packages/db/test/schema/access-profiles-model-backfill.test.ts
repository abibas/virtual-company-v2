import type { ProfileProvider } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { accessProfiles, auditLog } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import { type AgentBefore0017, insertAgentBefore0017, insertCompany, insertUser } from '../fixtures/rows.ts';

/**
 * The data step of migration `0017_profile_model` (the `-- custom:` part of `migrations/0017_profile_model.sql`): agents
 * stop having a model and an effort, and their access profiles take them. Each profile takes the model and the effort
 * most used by its agents (archived ones too), a tie going to the newest agent's; Codex's default marker and a model of
 * the other provider become null (the provider's default); a profile no agent uses keeps both null. Then the agents'
 * columns go. The rows are seeded at `0016_gateway_provider`, with the columns the tables had then.
 */

const BY = 'migration:0017_profile_model';
let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0016_gateway_provider');
});
afterAll(() => testDb.close());

/** A profile written with the columns `access_profiles` had at `0016`: no model or effort. */
async function profileAt0016(ownerUserId: string, provider: ProfileProvider): Promise<string> {
  const id = newId();
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, provider) values (${id}, ${ownerUserId}, ${id}, ${provider})`,
  );
  return id;
}

const columnsOf = async (table: string) =>
  (
    await queryRows<{ column_name: string }>(
      handle,
      sql`select column_name from information_schema.columns where table_name = ${table}`,
    )
  ).map((row) => row.column_name);

describe(`0017_profile_model on ${testDbKind()}: the model and the effort move to the access profile`, () => {
  const ids: Record<string, string> = {};
  let minute = 0;

  /** Agents on a profile, oldest first (a minute apart), with the models and efforts they had. */
  async function agentsOn(companyId: string, profileId: string, ...rows: AgentBefore0017[]) {
    for (const row of rows) {
      const createdAt = new Date(Date.UTC(2026, 10, 1, 9, minute++));
      await insertAgentBefore0017(handle, companyId, { profileId, createdAt, ...row });
    }
  }

  beforeAll(async () => {
    const ihor = (await insertUser(handle)).id;
    const companyId = (await insertCompany(handle)).id;
    const elsewhere = (await insertCompany(handle)).id;
    const claude = { harness: 'claude_code' } as const;
    const codex = { harness: 'codex' } as const;

    ids.work = await profileAt0016(ihor, 'claude');
    await agentsOn(companyId, ids.work, { ...claude, model: 'claude-opus-5-5', effort: 'high' });
    await agentsOn(elsewhere, ids.work, { ...claude, model: 'claude-opus-5-5', effort: 'max' });
    await agentsOn(companyId, ids.work, { ...claude, model: 'claude-sonnet-5-5', effort: 'max' });

    ids.tie = await profileAt0016(ihor, 'claude');
    await agentsOn(
      companyId,
      ids.tie,
      { ...claude, model: 'claude-sonnet-5-5', effort: 'low' },
      { ...claude, model: 'claude-haiku-5-5', effort: 'medium' },
    );

    ids.codexDefault = await profileAt0016(ihor, 'openai');
    await agentsOn(
      companyId,
      ids.codexDefault,
      { ...codex, model: 'codex-default', effort: 'high' },
      { ...codex, model: 'codex-default', effort: 'xhigh' },
      { ...codex, model: 'gpt-6.1-sol', effort: 'xhigh' },
    );

    ids.claudeOnOpenai = await profileAt0016(ihor, 'openai');
    await agentsOn(companyId, ids.claudeOnOpenai, { ...codex, model: 'claude-opus-5-5', effort: 'medium' });

    ids.gptOnClaude = await profileAt0016(ihor, 'claude');
    await agentsOn(companyId, ids.gptOnClaude, { ...claude, model: 'gpt-6.1-sol', effort: 'low' });

    ids.typed = await profileAt0016(ihor, 'openai');
    await agentsOn(companyId, ids.typed, { ...codex, model: 'gpt-7-preview', effort: 'max' });

    ids.archivedOnly = await profileAt0016(ihor, 'claude');
    await agentsOn(companyId, ids.archivedOnly, { ...claude, model: 'claude-fable-5-1', effort: 'xhigh' });
    await queryRows(
      handle,
      sql`update agents set status = 'archived' where profile_id = ${ids.archivedOnly}`,
    );

    ids.unusedClaude = await profileAt0016(ihor, 'claude');
    ids.unusedOpenai = await profileAt0016(ihor, 'openai');
    // An agent without a profile counts for none.
    await insertAgentBefore0017(handle, companyId, { model: 'claude-haiku-5-5', effort: 'low' });

    await migrateToLatest(handle);
  });

  const choice = async (id: string | undefined) => {
    const [row] = await handle.db
      .select()
      .from(accessProfiles)
      .where(eq(accessProfiles.id, id as string));
    return { model: row?.model, effort: row?.effort };
  };
  const audit = (id: string | undefined) =>
    handle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'access_profile'), eq(auditLog.entityId, id as string)))
      .orderBy(auditLog.field);

  it('applies the migration (and the ones after it)', async () => {
    expect(await migrationStatus(handle)).toMatchObject({ last: journal.entries.at(-1)?.tag, current: true });
  });

  it("gives a profile its agents' most used model and most used effort, each counted on its own", async () => {
    expect(await choice(ids.work)).toEqual({ model: 'claude-opus-5-5', effort: 'max' });
    expect(await audit(ids.work)).toMatchObject(
      [
        ['effort', 'max'],
        ['model', 'claude-opus-5-5'],
      ].map(([field, newValue]) => ({
        companyId: null,
        actorKind: 'system',
        actorPrincipalId: null,
        action: 'update',
        field,
        oldValue: null,
        newValue,
        requestId: BY,
      })),
    );
  });

  it("gives a tie to the newest agent's, and counts archived agents too", async () => {
    expect(await choice(ids.tie)).toEqual({ model: 'claude-haiku-5-5', effort: 'medium' });
    expect(await choice(ids.archivedOnly)).toEqual({ model: 'claude-fable-5-1', effort: 'xhigh' });
  });

  it("makes Codex's default marker the provider's default, keeping the effort", async () => {
    expect(await choice(ids.codexDefault)).toEqual({ model: null, effort: 'xhigh' });
    expect(await audit(ids.codexDefault)).toMatchObject([
      { field: 'effort', newValue: 'xhigh', requestId: BY },
    ]);
  });

  it("makes a model of the other provider the provider's default, and keeps a typed-in one of its own", async () => {
    expect(await choice(ids.claudeOnOpenai)).toEqual({ model: null, effort: 'medium' });
    expect(await choice(ids.gptOnClaude)).toEqual({ model: null, effort: 'low' });
    expect(await choice(ids.typed)).toEqual({ model: 'gpt-7-preview', effort: 'max' });
  });

  it('leaves a profile no agent uses on its provider’s defaults, with no audit rows', async () => {
    for (const id of [ids.unusedClaude, ids.unusedOpenai]) {
      expect(await choice(id)).toEqual({ model: null, effort: null });
      expect(await audit(id)).toEqual([]);
    }
  });

  it("drops the agents' model and effort, and the profiles hold them now", async () => {
    const agentColumns = await columnsOf('agents');
    expect(agentColumns).toEqual(expect.arrayContaining(['harness', 'profile_id']));
    expect(agentColumns).not.toContain('model');
    expect(agentColumns).not.toContain('effort');
    expect(await columnsOf('access_profiles')).toEqual(expect.arrayContaining(['model', 'effort']));
  });
});
