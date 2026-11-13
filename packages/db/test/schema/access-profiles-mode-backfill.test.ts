import { newId } from '@mwc/shared/ids';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { aiPartOf } from '../../src/profile-parts.ts';
import { accessProfiles, auditLog } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import { insertAgent, insertCompany, insertMachine, insertUser } from '../fixtures/rows.ts';

/**
 * The data step of migration `0035_profile_mode` (the `-- custom:` part of `migrations/0035_profile_mode.sql`): the
 * agents' placements stop saying whether their runs ask (`permission_policy`), and each profile's AI part takes a mode
 * from the agents that run on it now (not archived, with a placement): Skip prompts or Full trust when all of them had
 * `bypass`, else (all `ask`, or they differ) Manual or Ask; a profile no such agent uses keeps the default (null). The
 * rows are seeded at the migration before it.
 */

const BY = 'migration:0035_profile_mode';
const MINE = journal.entries.findIndex((entry) => entry.tag.endsWith('_profile_mode'));
const BEFORE = (journal.entries[MINE - 1] as { tag: string }).tag;

let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, BEFORE);
});
afterAll(() => testDb.close());

type Part = 'claude' | 'openai' | 'tools';

/** A profile with the columns `access_profiles` had before: one AI part (or tool parts only). */
async function profileBefore(ownerUserId: string, part: Part): Promise<string> {
  const id = newId();
  const rights = part === 'tools' ? JSON.stringify({ repos: 'all', push: false, pullRequests: false }) : null;
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, claude_part, openai_part, github_rights)
        values (${id}, ${ownerUserId}, ${id}, ${part === 'claude'}, ${part === 'openai'}, ${rights}::jsonb)`,
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

describe(`0035_profile_mode on ${testDbKind()}: the mode moves from the placements to the profiles`, () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const ihor = (await insertUser(handle)).id;
    const companyId = (await insertCompany(handle)).id;
    const machineId = (await insertMachine(handle, companyId)).id;

    /** An agent on the profile with a placement of this policy (none: no placement), active unless archived. */
    const agentOn = async (profileId: string, policy: 'ask' | 'bypass' | null, archived = false) => {
      const agent = await insertAgent(handle, companyId, {
        profileId,
        status: archived ? 'archived' : 'active',
      });
      if (policy === null) return;
      await queryRows(
        handle,
        sql`insert into agent_placements (id, company_id, agent_id, machine_id, mode, home, permission_policy)
            values (${newId()}, ${companyId}, ${agent.id}, ${machineId}, 'host', '/work', ${policy})`,
      );
    };

    ids.trusted = await profileBefore(ihor, 'claude');
    await agentOn(ids.trusted, 'bypass');
    await agentOn(ids.trusted, 'bypass');
    await agentOn(ids.trusted, 'ask', true);
    ids.codexTrusted = await profileBefore(ihor, 'openai');
    await agentOn(ids.codexTrusted, 'bypass');
    ids.asking = await profileBefore(ihor, 'claude');
    await agentOn(ids.asking, 'ask');
    await agentOn(ids.asking, 'ask');
    ids.differ = await profileBefore(ihor, 'claude');
    await agentOn(ids.differ, 'bypass');
    await agentOn(ids.differ, 'ask');
    ids.codexDiffer = await profileBefore(ihor, 'openai');
    await agentOn(ids.codexDiffer, 'ask');
    await agentOn(ids.codexDiffer, 'bypass');
    ids.unused = await profileBefore(ihor, 'claude');
    ids.archivedOnly = await profileBefore(ihor, 'openai');
    await agentOn(ids.archivedOnly, 'bypass', true);
    ids.unplaced = await profileBefore(ihor, 'claude');
    await agentOn(ids.unplaced, null);
    ids.tools = await profileBefore(ihor, 'tools');
    await agentOn(ids.tools, 'bypass');

    await migrateToLatest(handle);
  });

  const modes = async (id: string | undefined) => {
    const [row] = await handle.db
      .select()
      .from(accessProfiles)
      .where(eq(accessProfiles.id, id as string));
    return { claude: row?.claudeMode, openai: row?.openaiMode };
  };
  const audit = (id: string | undefined) =>
    handle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'access_profile'), eq(auditLog.entityId, id as string)));

  it('applies the migration', async () => {
    expect((await migrationStatus(handle)).current).toBe(true);
  });

  it('gives Skip prompts or Full trust to a part whose agents all skipped the prompts (archived ones aside)', async () => {
    expect(await modes(ids.trusted)).toEqual({ claude: 'bypassPermissions', openai: null });
    expect(await modes(ids.codexTrusted)).toEqual({ claude: null, openai: 'full' });
    expect(await audit(ids.trusted)).toMatchObject([
      {
        companyId: null,
        actorKind: 'system',
        action: 'update',
        field: 'claudeMode',
        oldValue: null,
        newValue: 'bypassPermissions',
        requestId: BY,
      },
    ]);
    expect(await audit(ids.codexTrusted)).toMatchObject([{ field: 'openaiMode', newValue: 'full' }]);
  });

  it('gives Manual or Ask when its agents all asked or differed', async () => {
    expect(await modes(ids.asking)).toEqual({ claude: 'manual', openai: null });
    expect(await modes(ids.differ)).toEqual({ claude: 'manual', openai: null });
    expect(await modes(ids.codexDiffer)).toEqual({ claude: null, openai: 'ask' });
    expect(await audit(ids.differ)).toMatchObject([
      { field: 'claudeMode', newValue: 'manual', requestId: BY },
    ]);
  });

  it('keeps the default for a profile no running, placed agent uses, and for one with no AI part', async () => {
    for (const id of [ids.unused, ids.archivedOnly, ids.unplaced, ids.tools]) {
      expect(await modes(id)).toEqual({ claude: null, openai: null });
      expect(await audit(id)).toEqual([]);
    }
    const [unused] = await handle.db
      .select()
      .from(accessProfiles)
      .where(eq(accessProfiles.id, ids.unused as string));
    expect(aiPartOf(unused as typeof accessProfiles.$inferSelect, 'claude')?.mode).toBe('manual');
  });

  it("drops the placements' setting", async () => {
    expect(await columnsOf('agent_placements')).not.toContain('permission_policy');
    expect(await columnsOf('access_profiles')).toEqual(
      expect.arrayContaining(['claude_mode', 'openai_mode']),
    );
  });
});
