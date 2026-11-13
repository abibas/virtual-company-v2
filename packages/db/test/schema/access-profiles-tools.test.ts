import { randomBytes } from 'node:crypto';
import type { CredentialKind } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { PROFILE_TOOL_COLUMNS } from '../../src/profile-tools.ts';
import { accessProfiles, agents, credentials, type NewAccessProfile } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertUser, MISSING_ID, migratedTestDb, unique } from '../fixtures/rows.ts';

/**
 * An access profile's tool parts (migration `0032_profile_tool_parts`, S7.1b reshaped on 2026-11-13): each one sign-in
 * of its owner's (`<tool>_credential_id`, let go when the sign-in is removed) and its rights (`<tool>_rights`). That the
 * sign-in is of the part's tool and the rights of its shape are the credentials module's rules; SQL keeps that a sign-in
 * comes with its rights and that they are an object. Profiles are Claude or OpenAI ones again, and agents hold one
 * profile only. The data step is `access-profiles-tools-backfill.test.ts`'s.
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
const ATLASSIAN_RIGHTS = {
  jira: 'read',
  jiraProjects: 'all',
  confluence: 'write',
  confluenceSpaces: ['ENG'],
};

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
    .values({ ownerUserId: ownerId, name: unique('profile'), provider: 'claude', ...values })
    .returning();
  return row as typeof accessProfiles.$inferSelect;
};

const profileRow = async (id: string) =>
  (await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, id)))[0];

describe('a profile’s tool parts', () => {
  it('are none on a new profile, and each holds a sign-in and its rights beside the AI part', async () => {
    expect(await profile()).toMatchObject({
      githubCredentialId: null,
      githubRights: null,
      atlassianCredentialId: null,
      atlassianRights: null,
    });
    const claude = await signIn('claude_oauth');
    const github = await signIn('github_oauth');
    const atlassian = await signIn('atlassian_api_token');
    const full = await profile({
      credentialId: claude.id,
      model: 'claude-opus-5-5',
      githubCredentialId: github.id,
      githubRights: GITHUB_RIGHTS,
      atlassianCredentialId: atlassian.id,
      atlassianRights: ATLASSIAN_RIGHTS,
    });
    expect(full).toMatchObject({
      provider: 'claude',
      credentialId: claude.id,
      githubCredentialId: github.id,
      githubRights: GITHUB_RIGHTS,
      atlassianCredentialId: atlassian.id,
      atlassianRights: ATLASSIAN_RIGHTS,
    });
  });

  it('may be there without a sign-in (rights only)', async () => {
    expect(await profile({ provider: 'openai', githubRights: GITHUB_RIGHTS })).toMatchObject({
      githubCredentialId: null,
      githubRights: GITHUB_RIGHTS,
    });
  });

  it.each([
    ['github', 'githubCredentialId', 'access_profiles_github_check'],
    ['atlassian', 'atlassianCredentialId', 'access_profiles_atlassian_check'],
  ] as const)('refuses a %s sign-in without its rights', async (tool, column, constraint) => {
    const held = await signIn(tool === 'github' ? 'github_token' : 'atlassian_api_token');
    expect(await pgError(profile({ [column]: held.id }))).toMatchObject({ code: '23514', constraint });
  });

  it.each([
    ['githubRights', 'access_profiles_github_rights_check'],
    ['atlassianRights', 'access_profiles_atlassian_rights_check'],
  ] as const)('refuses %s that are no object', async (column, constraint) => {
    const rights = ['push'] as unknown as Record<string, unknown>;
    expect(await pgError(profile({ [column]: rights }))).toMatchObject({ code: '23514', constraint });
  });

  it('refuses a tool provider: a profile is Claude’s or OpenAI’s', async () => {
    for (const provider of ['github', 'atlassian']) {
      expect(await pgError(profile({ provider: provider as 'claude' }))).toMatchObject({
        code: '23514',
        constraint: 'access_profiles_provider_check',
      });
    }
  });

  it('refuses a sign-in that does not exist', async () => {
    const missing = profile({ githubCredentialId: MISSING_ID, githubRights: GITHUB_RIGHTS });
    expect(await pgError(missing)).toMatchObject({
      code: '23503',
      constraint: 'access_profiles_github_credential_id_credentials_id_fk',
    });
  });

  it('keeps the part with its rights once its sign-in is removed', async () => {
    const github = await signIn('github_token');
    const atlassian = await signIn('atlassian_api_token');
    const row = await profile({
      githubCredentialId: github.id,
      githubRights: GITHUB_RIGHTS,
      atlassianCredentialId: atlassian.id,
      atlassianRights: ATLASSIAN_RIGHTS,
    });
    await handle.db.delete(credentials).where(eq(credentials.id, github.id));
    expect(await profileRow(row.id)).toMatchObject({
      githubCredentialId: null,
      githubRights: GITHUB_RIGHTS,
      atlassianCredentialId: atlassian.id,
    });
  });

  it('names each part’s two columns, keys to credentials let go with them', () => {
    expect(PROFILE_TOOL_COLUMNS).toEqual({
      github: { credential: 'githubCredentialId', rights: 'githubRights' },
      atlassian: { credential: 'atlassianCredentialId', rights: 'atlassianRights' },
    });
    const refs = getTableConfig(accessProfiles).foreignKeys.map((fk) => [
      fk.reference().columns.map((c) => c.name),
      fk.onDelete,
    ]);
    expect(refs).toEqual(
      expect.arrayContaining([
        [['github_credential_id'], 'set null'],
        [['atlassian_credential_id'], 'set null'],
      ]),
    );
  });
});

describe('an agent', () => {
  it('holds one access profile, and no tool profiles of its own any more', () => {
    const columns = getTableConfig(agents).columns.map((column) => column.name);
    expect(columns.filter((name) => name.endsWith('profile_id'))).toEqual(['profile_id']);
  });
});
