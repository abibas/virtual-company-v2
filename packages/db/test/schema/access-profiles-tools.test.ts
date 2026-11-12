import { randomBytes } from 'node:crypto';
import type { CredentialKind } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { accessProfiles, agents, credentials, type NewAccessProfile } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import {
  insertAgent,
  insertCompany,
  insertUser,
  MISSING_ID,
  migratedTestDb,
  unique,
} from '../fixtures/rows.ts';

/**
 * Migration `0030_tool_profiles` (S7.1b): GitHub and Atlassian profiles, which hold a tool sign-in and rights and no
 * gateway, model or effort, and an agent's GitHub and Atlassian profiles. That a tool profile's sign-in is of its tool,
 * and its rights of its tool's shape, are the credentials module's rules; SQL keeps that only tool profiles have rights,
 * that they are an object, and that tool profiles have no AI parts. No data step: every profile before it is an AI one.
 */

let testDb: TestDb;
let handle: RawDbHandle;
let ownerId: string;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  ownerId = (await insertUser(handle)).id;
});
afterAll(() => testDb.close());

const GITHUB_RIGHTS = { repos: ['AiriaLLC/*'], push: true, pullRequests: false };

const signIn = async (kind: CredentialKind) => {
  const [row] = await handle.db
    .insert(credentials)
    .values({
      ownerUserId: ownerId,
      kind,
      label: unique('sign-in'),
      keyVersion: 1,
      iv: new Uint8Array(randomBytes(12)),
      authTag: new Uint8Array(randomBytes(16)),
      ciphertext: new Uint8Array(randomBytes(40)),
    })
    .returning();
  return row as typeof credentials.$inferSelect;
};

const profile = async (values: Partial<NewAccessProfile> = {}) => {
  const [row] = await handle.db
    .insert(accessProfiles)
    .values({
      ownerUserId: ownerId,
      name: unique('tool'),
      provider: 'github',
      rights: GITHUB_RIGHTS,
      ...values,
    })
    .returning();
  return row as typeof accessProfiles.$inferSelect;
};

describe('tool profiles', () => {
  it('hold a sign-in and their rights, GitHub’s or Atlassian’s', async () => {
    const github = await signIn('github_oauth');
    const atlassian = await signIn('atlassian_api_token');
    expect(await profile({ credentialId: github.id })).toMatchObject({
      provider: 'github',
      credentialId: github.id,
      rights: GITHUB_RIGHTS,
      gatewayCredentialId: null,
      model: null,
      effort: null,
    });
    const rights = { jira: 'read', jiraProjects: 'all', confluence: 'read', confluenceSpaces: 'all' };
    expect(await profile({ provider: 'atlassian', credentialId: atlassian.id, rights })).toMatchObject({
      provider: 'atlassian',
      rights,
    });
  });

  it.each([
    ['a tool profile without rights', { rights: null }, 'access_profiles_rights_check'],
    ['an AI profile with rights', { provider: 'claude' as const }, 'access_profiles_rights_check'],
    [
      'rights that are no object',
      { rights: ['push'] as unknown as Record<string, unknown> },
      'access_profiles_rights_object_check',
    ],
    ['a tool profile with a model', { model: 'claude-opus-5-5' }, 'access_profiles_tool_check'],
    ['a tool profile with an effort', { effort: 'high' as const }, 'access_profiles_tool_check'],
  ])('refuses %s', async (_, values, constraint) => {
    expect(await pgError(profile(values))).toMatchObject({ code: '23514', constraint });
  });

  it('refuses a tool profile with a gateway', async () => {
    const gateway = await signIn('gateway');
    expect(await pgError(profile({ gatewayCredentialId: gateway.id }))).toMatchObject({
      code: '23514',
      constraint: 'access_profiles_tool_check',
    });
  });

  it('is empty once its sign-in is removed', async () => {
    const github = await signIn('github_token');
    const row = await profile({ credentialId: github.id });
    await handle.db.delete(credentials).where(eq(credentials.id, github.id));
    const [after] = await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, row.id));
    expect(after).toMatchObject({ credentialId: null, rights: GITHUB_RIGHTS });
  });
});

describe('an agent’s tool profiles', () => {
  it('are none by default, and each is taken off its agents when the profile is removed', async () => {
    const company = await insertCompany(handle);
    expect(await insertAgent(handle, company.id)).toMatchObject({
      githubProfileId: null,
      atlassianProfileId: null,
    });
    const github = await profile();
    const rights = { jira: 'off', jiraProjects: [], confluence: 'write', confluenceSpaces: ['ENG'] };
    const atlassian = await profile({ provider: 'atlassian', rights });
    const agent = await insertAgent(handle, company.id, {
      githubProfileId: github.id,
      atlassianProfileId: atlassian.id,
    });
    const agentRow = async () => (await handle.db.select().from(agents).where(eq(agents.id, agent.id)))[0];
    await handle.db.delete(accessProfiles).where(eq(accessProfiles.id, github.id));
    expect(await agentRow()).toMatchObject({ githubProfileId: null, atlassianProfileId: atlassian.id });
    await handle.db.delete(accessProfiles).where(eq(accessProfiles.id, atlassian.id));
    expect(await agentRow()).toMatchObject({ githubProfileId: null, atlassianProfileId: null });
  });

  it('refuses one naming no profile', async () => {
    const company = await insertCompany(handle);
    for (const [field, column] of [
      ['githubProfileId', 'github_profile_id'],
      ['atlassianProfileId', 'atlassian_profile_id'],
    ] as const) {
      expect(await pgError(insertAgent(handle, company.id, { [field]: MISSING_ID }))).toMatchObject({
        code: '23503',
        constraint: `agents_${column}_access_profiles_id_fk`,
      });
    }
  });

  it('are plain keys to personal rows, indexed, let go with the profile', () => {
    const config = getTableConfig(agents);
    const refs = config.foreignKeys
      .map((fk) => [fk.reference().columns.map((c) => c.name), fk.onDelete])
      .filter(([columns]) => (columns as string[]).some((name) => name.endsWith('profile_id')));
    expect(refs).toEqual(
      expect.arrayContaining([
        [['github_profile_id'], 'set null'],
        [['atlassian_profile_id'], 'set null'],
      ]),
    );
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['agents_github_profile_idx', 'agents_atlassian_profile_idx']),
    );
  });
});
