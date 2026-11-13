import { newId } from '@mwc/shared/ids';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import { accessProfiles, auditLog } from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { migrateUpTo } from '../fixtures/migrations.ts';
import {
  type AgentBefore0032,
  BEFORE_GENERIC_PROFILES,
  insertAgentBefore0032,
  insertCompany,
  insertCredentialBefore0029,
  insertUser,
} from '../fixtures/rows.ts';

/**
 * The data step of migration `0032_generic_profiles` (the `-- custom:` part of `migrations/0032_generic_profiles.sql`):
 * a profile stops having one provider and becomes a name with parts. Every profile keeps its id and gets the one part
 * its provider was, nothing deleted; an agent's GitHub and Atlassian profiles are also copied into the agent's profile
 * when that keeps everyone's access as it was, else the migration refuses and changes nothing. The rows are seeded at
 * `0031_team_room`, with the columns the tables had then.
 */

const BY = 'migration:0032_generic_profiles';
const PUSH = { repos: ['AiriaLLC/*'], push: true, pullRequests: true };
const WIKI = { jira: 'read', jiraProjects: 'all', confluence: 'write', confluenceSpaces: ['ENG'] };

/** A profile written with the columns `access_profiles` had at `0031`: one provider, a tool profile with `rights`. */
async function profileAt0031(
  handle: RawDbHandle,
  ownerUserId: string,
  values: {
    provider: string;
    name?: string;
    credentialId?: string | null;
    gatewayCredentialId?: string | null;
    model?: string | null;
    effort?: string | null;
    rights?: object | null;
  },
): Promise<string> {
  const id = newId();
  const rights = values.rights === undefined || values.rights === null ? null : JSON.stringify(values.rights);
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, provider, credential_id, gateway_credential_id, model,
          effort, rights)
        values (${id}, ${ownerUserId}, ${values.name ?? id}, ${values.provider}, ${values.credentialId ?? null},
                ${values.gatewayCredentialId ?? null}, ${values.model ?? null}, ${values.effort ?? null},
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

describe(`0032_generic_profiles on ${testDbKind()}: profiles become a name with parts`, () => {
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
    await migrateUpTo(handle, BEFORE_GENERIC_PROFILES);
    const ihor = (await insertUser(handle)).id;
    const company = (await insertCompany(handle)).id;
    const elsewhere = (await insertCompany(handle)).id;
    const agent = (companyId: string, values: AgentBefore0032) =>
      insertAgentBefore0032(handle, companyId, values);
    const credential = async (kind: string) => (await insertCredentialBefore0029(handle, ihor, kind)).id;

    ids.claudeSub = await credential('claude_oauth');
    ids.openaiSub = await credential('codex_oauth');
    ids.gateway = await credential('gateway');
    ids.work = await profileAt0031(handle, ihor, {
      provider: 'claude',
      name: 'Work',
      credentialId: ids.claudeSub,
      gatewayCredentialId: ids.gateway,
      model: 'claude-opus-5-5',
      effort: 'high',
    });
    ids.codex = await profileAt0031(handle, ihor, {
      provider: 'openai',
      name: 'Codex',
      credentialId: ids.openaiSub,
      model: 'gpt-6.1-sol',
      effort: 'ultra',
    });
    ids.plain = await profileAt0031(handle, ihor, { provider: 'claude', name: 'Plain' });

    // Ihor's two tool-only profiles no agent uses, each with its sign-in.
    ids.githubSignIn = await credential('github_oauth');
    ids.atlassianSignIn = await credential('atlassian_api_token');
    ids.airiaGithub = await profileAt0031(handle, ihor, {
      provider: 'github',
      name: 'Airia GitHub acc - Ihor',
      credentialId: ids.githubSignIn,
      rights: PUSH,
    });
    ids.airiaAtlassian = await profileAt0031(handle, ihor, {
      provider: 'atlassian',
      name: 'Airia Atlassian acc - Ihor',
      credentialId: ids.atlassianSignIn,
      rights: WIKI,
    });

    // A GitHub profile on every agent of two profiles (one agent archived, one in another company), and an Atlassian
    // profile without a sign-in on every agent of the first.
    ids.pushSignIn = await credential('github_token');
    ids.github = await profileAt0031(handle, ihor, {
      provider: 'github',
      credentialId: ids.pushSignIn,
      rights: PUSH,
    });
    ids.atlassian = await profileAt0031(handle, ihor, { provider: 'atlassian', rights: WIKI });
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
    (
      await handle.db
        .select()
        .from(accessProfiles)
        .where(eq(accessProfiles.id, id as string))
    )[0];

  it('gives a Claude or OpenAI profile its one AI part, with its subscription, gateway, model and effort', async () => {
    expect(await profileRow(ids.work as string)).toMatchObject({
      name: 'Work',
      claudePart: true,
      claudeCredentialId: ids.claudeSub,
      claudeGatewayCredentialId: ids.gateway,
      claudeModel: 'claude-opus-5-5',
      claudeEffort: 'high',
      openaiPart: false,
    });
    expect(await profileRow(ids.codex as string)).toMatchObject({
      claudePart: false,
      openaiPart: true,
      openaiCredentialId: ids.openaiSub,
      openaiGatewayCredentialId: null,
      openaiModel: 'gpt-6.1-sol',
      openaiEffort: 'ultra',
    });
    expect(await profileRow(ids.plain as string)).toMatchObject({
      claudePart: true,
      claudeCredentialId: null,
      githubRights: null,
      atlassianRights: null,
    });
    expect(await audit(ids.plain as string)).toEqual([['update', 'provider', 'claude', null, null]]);
  });

  it('keeps every tool-only profile, as a profile with just its GitHub or Atlassian part', async () => {
    expect(await profileRow(ids.airiaGithub as string)).toMatchObject({
      name: 'Airia GitHub acc - Ihor',
      claudePart: false,
      openaiPart: false,
      githubCredentialId: ids.githubSignIn,
      githubRights: PUSH,
      atlassianRights: null,
    });
    expect(await profileRow(ids.airiaAtlassian as string)).toMatchObject({
      name: 'Airia Atlassian acc - Ihor',
      atlassianCredentialId: ids.atlassianSignIn,
      atlassianRights: WIKI,
      githubRights: null,
    });
    expect(await profileRow(ids.atlassian as string)).toMatchObject({
      atlassianCredentialId: null,
      atlassianRights: WIKI,
    });
    expect(await handle.db.select({ id: accessProfiles.id }).from(accessProfiles)).toHaveLength(7);
    expect(await audit(ids.airiaGithub as string)).toEqual([['update', 'provider', 'github', null, null]]);
  });

  it('copies an agent’s tool profiles into each profile its agents are on, audited', async () => {
    expect(await profileRow(ids.work as string)).toMatchObject({
      githubCredentialId: ids.pushSignIn,
      githubRights: PUSH,
      atlassianCredentialId: null,
      atlassianRights: WIKI,
    });
    expect(await profileRow(ids.codex as string)).toMatchObject({
      githubCredentialId: ids.pushSignIn,
      githubRights: PUSH,
      atlassianRights: null,
    });
    expect(await audit(ids.work as string)).toEqual([
      ['update', 'provider', 'claude', null, null],
      ['update', 'githubCredentialId', null, ids.pushSignIn, null],
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
    expect(await audit(ids.plainAgent as string)).toEqual([]);
  });

  it('drops the provider, its columns, the rights and the agents’ tool profiles', async () => {
    const profileColumns = await columnsOf(handle, 'access_profiles');
    for (const gone of ['provider', 'credential_id', 'gateway_credential_id', 'model', 'effort', 'rights']) {
      expect(profileColumns).not.toContain(gone);
    }
    expect(await columnsOf(handle, 'agents')).not.toContain('github_profile_id');
    expect(await columnsOf(handle, 'agents')).not.toContain('atlassian_profile_id');
    expect((await migrationStatus(handle)).current).toBe(true);
  });
});

describe(`0032_generic_profiles on ${testDbKind()}: refuses what it cannot copy, changing nothing`, () => {
  let testDb: TestDb;
  let handle: RawDbHandle;
  beforeAll(async () => {
    testDb = await createTestDb();
    handle = testDb.handle;
    await migrateUpTo(handle, BEFORE_GENERIC_PROFILES);
  });
  afterAll(() => testDb.close());

  const fix = (agentId: string, set: ReturnType<typeof sql>) =>
    queryRows(handle, sql`update agents set ${set} where id = ${agentId}`);

  it('names each problem in turn until there is none, then migrates', async () => {
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
    expect((await migrationStatus(handle)).last).toBe(BEFORE_GENERIC_PROFILES);
    expect(await columnsOf(handle, 'agents')).toContain('github_profile_id');
    await fix(bare.id, sql`profile_id = ${work}`);

    expect(await refusal(handle)).toMatch(/of another person than its access profile "Work"/);
    await fix(mixed.id, sql`atlassian_profile_id = null`);

    expect(await refusal(handle)).toMatch(/agents on the access profile "Work" .* do not all have the same/);
    await fix(plain.id, sql`github_profile_id = ${github}`);
    await fix(mixed.id, sql`github_profile_id = ${github}`);

    await migrateToLatest(handle);
    const [row] = await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, work));
    expect(row).toMatchObject({ claudePart: true, githubRights: PUSH, atlassianRights: null });
    expect(await handle.db.select({ id: accessProfiles.id }).from(accessProfiles)).toHaveLength(3);
  });
});
