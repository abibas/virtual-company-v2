import { randomBytes } from 'node:crypto';
import type { CredentialKind } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { aiPartOf, PROFILE_AI_COLUMNS, PROFILE_TOOL_COLUMNS } from '../../src/profile-parts.ts';
import { accessProfiles, credentials, type NewAccessProfile } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertUser, MISSING_ID, migratedTestDb, unique } from '../fixtures/rows.ts';

/**
 * A generic profile's parts (migration `0032_generic_profiles`, 2026-11-13): a Claude and an OpenAI part (a presence
 * flag, a subscription, a gateway, a model and an effort) and a GitHub and an Atlassian part (a sign-in and its rights).
 * Which credential fits a part, and the rights' shape, are the credentials module's rules; SQL keeps an AI part's fields
 * off while the part is not there, a model's length, the stored efforts, a tool part's sign-in only with its rights,
 * and its rights an object. The data step is `access-profiles-parts-backfill.test.ts`'s.
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
      label: unique('credential'),
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
    .values({ ownerUserId: ownerId, name: unique('profile'), ...values })
    .returning();
  return row as typeof accessProfiles.$inferSelect;
};

const profileRow = async (id: string) =>
  (await handle.db.select().from(accessProfiles).where(eq(accessProfiles.id, id)))[0];

describe('a profile’s AI parts', () => {
  it('hold a subscription, a gateway, a model and an effort each, both on one profile', async () => {
    const claude = await signIn('claude_oauth');
    const openai = await signIn('codex_oauth');
    const gateway = await signIn('gateway');
    const both = await profile({
      claudePart: true,
      claudeCredentialId: claude.id,
      claudeGatewayCredentialId: gateway.id,
      claudeModel: 'claude-opus-5-5',
      claudeEffort: 'max',
      openaiPart: true,
      openaiCredentialId: openai.id,
      openaiGatewayCredentialId: gateway.id,
      openaiModel: 'm'.repeat(100),
      openaiEffort: 'ultra',
    });
    expect(aiPartOf(both, 'claude')).toEqual({
      credentialId: claude.id,
      gatewayCredentialId: gateway.id,
      model: 'claude-opus-5-5',
      effort: 'max',
    });
    expect(aiPartOf(both, 'openai')).toMatchObject({ credentialId: openai.id, effort: 'ultra' });
    const empty = await profile({ claudePart: true });
    expect(aiPartOf(empty, 'claude')).toEqual({
      credentialId: null,
      gatewayCredentialId: null,
      model: null,
      effort: null,
    });
    expect(aiPartOf(empty, 'openai')).toBeUndefined();
  });

  it.each([
    ['claude', { claudeModel: 'claude-opus-5-5' }, 'access_profiles_claude_check'],
    ['claude', { claudeEffort: 'high' as const }, 'access_profiles_claude_check'],
    ['openai', { openaiModel: 'gpt-6.1-sol' }, 'access_profiles_openai_check'],
  ] as const)('refuses a %s field without its part', async (_, values, constraint) => {
    expect(await pgError(profile(values))).toMatchObject({ code: '23514', constraint });
  });

  it.each([
    ['an empty model', { claudePart: true, claudeModel: '' }, 'access_profiles_claude_model_check'],
    [
      'a model over 100',
      { openaiPart: true, openaiModel: 'm'.repeat(101) },
      'access_profiles_openai_model_check',
    ],
    [
      'an unknown effort',
      { claudePart: true, claudeEffort: 'turbo' as 'high' },
      'access_profiles_claude_effort_check',
    ],
  ])('refuses %s', async (_, values, constraint) => {
    expect(await pgError(profile(values))).toMatchObject({ code: '23514', constraint });
  });

  it('refuses a subscription naming no credential, and empties its place when one is removed', async () => {
    expect(await pgError(profile({ claudePart: true, claudeCredentialId: MISSING_ID }))).toMatchObject({
      code: '23503',
      constraint: 'access_profiles_claude_credential_id_credentials_id_fk',
    });
    const claude = await signIn('claude_setup_token');
    const gateway = await signIn('gateway');
    const row = await profile({
      claudePart: true,
      claudeCredentialId: claude.id,
      claudeGatewayCredentialId: gateway.id,
    });
    await handle.db.delete(credentials).where(eq(credentials.id, gateway.id));
    expect(await profileRow(row.id)).toMatchObject({
      claudePart: true,
      claudeCredentialId: claude.id,
      claudeGatewayCredentialId: null,
    });
  });
});

describe('a profile’s tool parts', () => {
  it('hold a sign-in and its rights, and may be there without a sign-in', async () => {
    const github = await signIn('github_oauth');
    const atlassian = await signIn('atlassian_api_token');
    const full = await profile({
      githubCredentialId: github.id,
      githubRights: GITHUB_RIGHTS,
      atlassianCredentialId: atlassian.id,
      atlassianRights: ATLASSIAN_RIGHTS,
    });
    expect(full).toMatchObject({
      claudePart: false,
      githubRights: GITHUB_RIGHTS,
      atlassianCredentialId: atlassian.id,
    });
    expect(await profile({ githubRights: GITHUB_RIGHTS })).toMatchObject({ githubCredentialId: null });
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

  it('keeps the part with its rights once its sign-in is removed', async () => {
    const github = await signIn('github_token');
    const row = await profile({ githubCredentialId: github.id, githubRights: GITHUB_RIGHTS });
    await handle.db.delete(credentials).where(eq(credentials.id, github.id));
    expect(await profileRow(row.id)).toMatchObject({ githubCredentialId: null, githubRights: GITHUB_RIGHTS });
  });
});

describe('the parts’ column maps', () => {
  it('name each part’s columns', () => {
    expect(Object.keys(PROFILE_AI_COLUMNS)).toEqual(['claude', 'openai']);
    expect(PROFILE_AI_COLUMNS.openai).toEqual({
      part: 'openaiPart',
      credential: 'openaiCredentialId',
      gateway: 'openaiGatewayCredentialId',
      model: 'openaiModel',
      effort: 'openaiEffort',
    });
    expect(PROFILE_TOOL_COLUMNS).toEqual({
      github: { credential: 'githubCredentialId', rights: 'githubRights' },
      atlassian: { credential: 'atlassianCredentialId', rights: 'atlassianRights' },
    });
  });
});
