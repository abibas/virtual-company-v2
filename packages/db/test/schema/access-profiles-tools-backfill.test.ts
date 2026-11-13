import { newId } from '@mwc/shared/ids';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { accessProfiles, auditLog, credentials } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import {
  type AgentBefore0032,
  insertAgentBefore0032,
  insertCompany,
  insertCredentialBefore0029,
  insertUser,
} from '../fixtures/rows.ts';

/**
 * The data step of migration `0032_profile_tool_parts` (the `-- custom:` part of `migrations/0032_profile_tool_parts.sql`):
 * GitHub and Atlassian stop being profiles of their own and become parts of the access profile. A tool profile no agent
 * uses is deleted (its sign-in stays); one an agent uses is folded into that agent's access profile, only when that keeps
 * everyone's access as it was, else the migration refuses and changes nothing. The rows are seeded at `0031_team_room`,
 * with the columns the tables had then.
 */

const BY = 'migration:0032_profile_tool_parts';
const PUSH = { repos: ['AiriaLLC/*'], push: true, pullRequests: true };
const WIKI = { jira: 'read', jiraProjects: 'all', confluence: 'write', confluenceSpaces: ['ENG'] };

/** A profile written with the columns `access_profiles` had at `0031`: a tool profile has `rights`. */
async function profileAt0031(
  handle: RawDbHandle,
  ownerUserId: string,
  values: { provider: string; name?: string; credentialId?: string | null; rights?: object | null },
): Promise<string> {
  const id = newId();
  const rights = values.rights === undefined || values.rights === null ? null : JSON.stringify(values.rights);
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, provider, credential_id, rights)
        values (${id}, ${ownerUserId}, ${values.name ?? id}, ${values.provider}, ${values.credentialId ?? null},
                ${rights}::jsonb)`,
  );
  return id;
}

const columnsOf = async (handle: RawDbHandle, table: string) =>
  (
    await queryRows<{ column_name: string }>(
      handle,
      sql`select column_name from information_schema.columns where table_name = ${table}`,
    )
  ).map((row) => row.column_name);

/** The migration's own refusal: the message (and hint) of the database error behind the rejected migration. */
async function refusal(handle: RawDbHandle): Promise<string> {
  try {
    await migrateToLatest(handle);
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as { message?: string; hint?: string };
    return `${cause.message ?? ''} ${cause.hint ?? ''}`;
  }
  throw new Error('expected the migration to refuse');
}

describe(`0032_profile_tool_parts on ${testDbKind()}: tool profiles fold into access profiles`, () => {
  let testDb: TestDb;
  let handle: RawDbHandle;
  const ids: Record<string, string> = {};

  const audit = async (entityId: string) =>
    (
      await handle.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, entityId), eq(auditLog.requestId, BY)))
        .orderBy(asc(auditLog.id))
    ).map((row) => [row.action, row.field, row.oldValue, row.newValue, row.companyId]);

  beforeAll(async () => {
    testDb = await createTestDb();
    handle = testDb.handle;
    await migrateUpTo(handle, '0031_team_room');
    const ihor = (await insertUser(handle)).id;
    const company = (await insertCompany(handle)).id;
    const elsewhere = (await insertCompany(handle)).id;
    const agent = (companyId: string, values: AgentBefore0032) =>
      insertAgentBefore0032(handle, companyId, values);

    // Ihor's two unused tool-only profiles, each with its sign-in.
    ids.unusedGithubSignIn = (await insertCredentialBefore0029(handle, ihor, 'github_oauth')).id;
    ids.unusedAtlassianSignIn = (await insertCredentialBefore0029(handle, ihor, 'atlassian_api_token')).id;
    ids.unusedGithub = await profileAt0031(handle, ihor, {
      provider: 'github',
      name: 'Airia GitHub acc - Ihor',
      credentialId: ids.unusedGithubSignIn,
      rights: { repos: [], push: false, pullRequests: false },
    });
    ids.unusedAtlassian = await profileAt0031(handle, ihor, {
      provider: 'atlassian',
      name: 'Airia Atlassian acc - Ihor',
      credentialId: ids.unusedAtlassianSignIn,
      rights: WIKI,
    });

    // A GitHub profile used by every agent on two AI profiles (one agent archived, one in another company), and an
    // Atlassian profile without a sign-in used by every agent on the first.
    ids.githubSignIn = (await insertCredentialBefore0029(handle, ihor, 'github_token')).id;
    ids.github = await profileAt0031(handle, ihor, {
      provider: 'github',
      credentialId: ids.githubSignIn,
      rights: PUSH,
    });
    ids.atlassian = await profileAt0031(handle, ihor, { provider: 'atlassian', rights: WIKI });
    ids.work = await profileAt0031(handle, ihor, { provider: 'claude', name: 'Work' });
    ids.codex = await profileAt0031(handle, ihor, { provider: 'openai', name: 'Codex' });
    ids.plain = await profileAt0031(handle, ihor, { provider: 'claude', name: 'Plain' });
    const tools = { githubProfileId: ids.github, atlassianProfileId: ids.atlassian };
    ids.dev = (await agent(company, { profileId: ids.work, ...tools })).id;
    ids.qa = (await agent(company, { profileId: ids.work, ...tools, status: 'archived' })).id;
    ids.coder = (await agent(elsewhere, { profileId: ids.codex, githubProfileId: ids.github })).id;
    ids.plainAgent = (await agent(company, { profileId: ids.plain })).id;
    ids.company = company;
    ids.elsewhere = elsewhere;
    await agent(company, {});
    await migrateToLatest(handle);
  });
  afterAll(() => testDb.close());

  const profileRow = async (id: string) =>
    (await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, id)))[0];

  it('deletes the tool profiles no agent uses, and keeps their sign-ins', async () => {
    expect(await profileRow(ids.unusedGithub as string)).toBeUndefined();
    expect(await profileRow(ids.unusedAtlassian as string)).toBeUndefined();
    const signIns = await handle.db.select({ id: credentials.id }).from(credentials);
    expect(signIns.map((row) => row.id)).toEqual(
      expect.arrayContaining([ids.unusedGithubSignIn, ids.unusedAtlassianSignIn, ids.githubSignIn]),
    );
    expect(await audit(ids.unusedGithub as string)).toEqual([
      ['delete', 'credentialId', ids.unusedGithubSignIn, null, null],
      ['delete', 'name', 'Airia GitHub acc - Ihor', null, null],
      ['delete', 'ownerUserId', expect.any(String), null, null],
      ['delete', 'provider', 'github', null, null],
      ['delete', 'rights', { repos: [], push: false, pullRequests: false }, null, null],
    ]);
  });

  it('folds a used tool profile’s sign-in and rights into each AI profile its agents are on, then deletes it', async () => {
    expect(await profileRow(ids.work as string)).toMatchObject({
      provider: 'claude',
      githubCredentialId: ids.githubSignIn,
      githubRights: PUSH,
      atlassianCredentialId: null,
      atlassianRights: WIKI,
    });
    expect(await profileRow(ids.codex as string)).toMatchObject({
      githubCredentialId: ids.githubSignIn,
      githubRights: PUSH,
      atlassianRights: null,
    });
    expect(await profileRow(ids.github as string)).toBeUndefined();
    expect(await profileRow(ids.atlassian as string)).toBeUndefined();
    expect(await audit(ids.work as string)).toEqual([
      ['update', 'githubCredentialId', null, ids.githubSignIn, null],
      ['update', 'githubRights', null, PUSH, null],
      ['update', 'atlassianRights', null, WIKI, null],
    ]);
  });

  it('records each agent’s tool profile taken off, in its company', async () => {
    expect(await audit(ids.dev as string)).toEqual([
      ['update', 'githubProfileId', ids.github, null, ids.company],
      ['update', 'atlassianProfileId', ids.atlassian, null, ids.company],
    ]);
    expect(await audit(ids.coder as string)).toEqual([
      ['update', 'githubProfileId', ids.github, null, ids.elsewhere],
    ]);
  });

  it('leaves a profile whose agents have no tool profiles without tool parts', async () => {
    expect(await profileRow(ids.plain as string)).toMatchObject({
      githubCredentialId: null,
      githubRights: null,
      atlassianCredentialId: null,
      atlassianRights: null,
    });
    expect(await audit(ids.plain as string)).toEqual([]);
    expect(await audit(ids.plainAgent as string)).toEqual([]);
  });

  it('drops the tool profiles’ columns', async () => {
    expect(await columnsOf(handle, 'agents')).not.toContain('github_profile_id');
    expect(await columnsOf(handle, 'agents')).not.toContain('atlassian_profile_id');
    expect(await columnsOf(handle, 'access_profiles')).not.toContain('rights');
    expect((await migrationStatus(handle)).current).toBe(true);
  });
});

describe(`0032_profile_tool_parts on ${testDbKind()}: refuses what it cannot fold, changing nothing`, () => {
  let testDb: TestDb;
  let handle: RawDbHandle;
  beforeAll(async () => {
    testDb = await createTestDb();
    handle = testDb.handle;
    await migrateUpTo(handle, '0031_team_room');
  });
  afterAll(() => testDb.close());

  const fix = (agentId: string, set: ReturnType<typeof sql>) =>
    queryRows(handle, sql`update agents set ${set} where id = ${agentId}`);

  it('names each problem in turn until there is none, then folds', async () => {
    const ihor = (await insertUser(handle)).id;
    const other = (await insertUser(handle)).id;
    const company = (await insertCompany(handle)).id;
    const github = await profileAt0031(handle, ihor, { provider: 'github', rights: PUSH });
    const theirs = await profileAt0031(handle, other, { provider: 'atlassian', rights: WIKI });
    const work = await profileAt0031(handle, ihor, { provider: 'claude', name: 'Work' });
    const bare = await insertAgentBefore0032(handle, company, { githubProfileId: github });
    const mixed = await insertAgentBefore0032(handle, company, {
      profileId: work,
      atlassianProfileId: theirs,
    });
    const plain = await insertAgentBefore0032(handle, company, { profileId: work });

    expect(await refusal(handle)).toMatch(
      /has a GitHub or Atlassian profile but no access profile.*Give the agent/,
    );
    expect((await migrationStatus(handle)).last).toBe('0031_team_room');
    expect(await columnsOf(handle, 'agents')).toContain('github_profile_id');
    await fix(bare.id, sql`profile_id = ${work}`);

    expect(await refusal(handle)).toMatch(/of another person than its access profile "Work"/);
    await fix(mixed.id, sql`atlassian_profile_id = null`);

    expect(await refusal(handle)).toMatch(/agents on the access profile "Work" .* do not all have the same/);
    await fix(plain.id, sql`github_profile_id = ${github}`);
    await fix(mixed.id, sql`github_profile_id = ${github}`);

    await migrateToLatest(handle);
    const [row] = await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, work));
    expect(row).toMatchObject({ githubRights: PUSH, atlassianRights: null });
    const left = await handle.db.select({ id: accessProfiles.id }).from(accessProfiles);
    expect(left.map((profile) => profile.id).sort()).toEqual([work]);
  });
});
