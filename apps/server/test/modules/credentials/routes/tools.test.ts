import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubscriptionView } from '../../../../src/modules/credentials/schemas.ts';
import { addUser, call, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { type LimitsWorld, limitsOf, limitsWorld, usesOf } from '../../../fixtures/credentials/providers.ts';
import {
  ATLASSIAN_TOKEN,
  addedTool,
  addTool,
  atlassian,
  auditOfCredential,
  CLASSIC_TOKEN,
  CONFLUENCE_CURRENT,
  checkAgain,
  confluenceCurrent,
  EMAIL,
  FINE_TOKEN,
  GITHUB_USER,
  githubToken,
  githubUser,
  JIRA_MYSELF,
  jiraMyself,
  noToolSecret,
  rowOf,
  SITE,
  status,
} from '../../../fixtures/credentials/tools.ts';
import { revokeSubscription } from '../../../fixtures/org.ts';
import { addPerson, seedApiKey } from '../../../fixtures/platform/auth.ts';

let w: LimitsWorld;
let ihor: LinkedUser;
let other: LinkedUser;
beforeAll(async () => {
  w = await limitsWorld();
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());
beforeEach(() => w.provider.reset());

const opened = (view: SubscriptionView, user = ihor) =>
  w.store.useCredentialSecret(view.id, user.userId, 'test');

describe('POST /api/me/subscriptions/tools: a GitHub token', () => {
  it('checks it with GitHub, then seals it with the account, its first check and that use, never shown again', async () => {
    w.provider.always(GITHUB_USER, githubUser());
    const res = await addTool(w, ihor, githubToken(), 'req-gh-1');
    expect(res.status).toBe(201);
    const view = res.body as SubscriptionView;
    const now = w.clock().toISOString();
    expect(view).toEqual({
      id: view.id,
      kind: 'github_token',
      label: 'GitHub · ihor-fake',
      accountEmail: null,
      accountMeta: {
        host: 'github.com',
        login: 'ihor-fake',
        name: 'Ihor Fake',
        scopes: ['repo', 'read:org', 'workflow'],
        tokenType: 'classic',
      },
      status: 'active',
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      lastUsedAt: now,
      checkedAt: now,
      checkError: null,
    });
    expect(w.provider.callsTo(GITHUB_USER)).toHaveLength(1);
    noToolSecret(res.body);
    noToolSecret(await rowOf(w.t.db, view.id));
    expect((await usesOf(w.t.db, view.id)).map((use) => [use.purpose, use.ownerUserId])).toEqual([
      ['tool_check', ihor.userId],
    ]);
    expect(
      (await auditOfCredential(w.t.db, view.id)).every(
        ([action, , by, request]) => action === 'create' && by === 'user' && request === 'req-gh-1',
      ),
    ).toBe(true);
    expect(await opened(view)).toMatchObject({
      ok: true,
      kind: 'github_token',
      secret: { token: CLASSIC_TOKEN },
    });
  });

  it('takes a fine-grained token under the name given, trimmed', async () => {
    w.provider.always(GITHUB_USER, githubUser(null));
    const view = await addedTool(w, ihor, githubToken(`  ${FINE_TOKEN}\n`, { label: '  Work GitHub  ' }));
    expect(view).toMatchObject({ label: 'Work GitHub', accountMeta: { tokenType: 'fine_grained' } });
    expect(view.accountMeta).not.toHaveProperty('scopes');
  });

  it('stores nothing when GitHub does not accept it (422) or does not answer (502)', async () => {
    const before = (await rawDb(w.t.db).select().from(credentials)).length;
    w.provider.once(GITHUB_USER, status(401)).once(GITHUB_USER, status(503));
    expect(await addTool(w, ihor, githubToken())).toMatchObject({
      status: 422,
      body: { error: { code: 'tool_sign_in_refused', message: 'GitHub did not accept this token.' } },
    });
    expect(await addTool(w, ihor, githubToken())).toMatchObject({
      status: 502,
      body: { error: { code: 'provider_unavailable', message: 'GitHub did not answer. Try again.' } },
    });
    expect((await rawDb(w.t.db).select().from(credentials)).length).toBe(before);
  });

  it.each([
    ['another prefix', githubToken('gho_FAKEoauthTOKEN')],
    ['spaces inside', githubToken('ghp_FAKE token')],
    ['other characters', githubToken('ghp_FAKE-token')],
    ['no token', { kind: 'github_token' }],
    ['an AI kind', { kind: 'claude_setup_token', token: 'sk-ant-oat01-x' }],
  ])('refuses %s with 400 before asking GitHub', async (_, body) => {
    expect(await addTool(w, ihor, body)).toMatchObject({ status: 400 });
    expect(w.provider.calls).toEqual([]);
  });
});

describe('POST /api/me/subscriptions/tools: Atlassian', () => {
  it('reads the site as its host, checks Jira and Confluence, and keeps which answer and who the account is', async () => {
    w.provider.always(JIRA_MYSELF, jiraMyself).always(CONFLUENCE_CURRENT, status(404));
    const view = await addedTool(w, ihor, atlassian());
    expect(view).toMatchObject({
      kind: 'atlassian_api_token',
      label: `Atlassian · ${SITE}`,
      accountEmail: EMAIL,
      accountMeta: {
        site: SITE,
        jira: true,
        confluence: false,
        accountId: '557058:fake-jira',
        displayName: 'Ihor Herasko',
      },
      status: 'active',
    });
    noToolSecret(view);
    expect(await opened(view)).toMatchObject({
      ok: true,
      secret: { site: SITE, email: EMAIL, token: ATLASSIAN_TOKEN },
    });
    expect((await usesOf(w.t.db, view.id)).map((use) => use.purpose)).toEqual(['tool_check', 'test']);
  });

  it('refuses a site where neither product answers, and an email and token Atlassian does not accept', async () => {
    w.provider.once(JIRA_MYSELF, status(404)).once(CONFLUENCE_CURRENT, status(404));
    expect(await addTool(w, ihor, atlassian())).toMatchObject({
      status: 422,
      body: { error: { message: `Neither Jira nor Confluence answered on ${SITE}.` } },
    });
    w.provider.once(JIRA_MYSELF, status(401)).once(CONFLUENCE_CURRENT, status(401));
    expect(await addTool(w, ihor, atlassian())).toMatchObject({
      status: 422,
      body: { error: { message: `Atlassian did not accept this email and API token on ${SITE}.` } },
    });
  });

  it.each([
    ['a site elsewhere', atlassian({ site: 'jira.example.com' })],
    ['no email', atlassian({ email: 'not an email' })],
    ['a token with spaces', atlassian({ token: 'ATATT a' })],
  ])('refuses %s with 400 before asking Atlassian', async (_, body) => {
    expect(await addTool(w, ihor, body)).toMatchObject({ status: 400 });
    expect(w.provider.calls).toEqual([]);
  });
});

describe('POST /api/me/subscriptions/tools with credentialId: a new secret in place', () => {
  it('replaces the secret of the caller’s own sign-in after its check, keeping its id and name', async () => {
    w.provider.always(GITHUB_USER, githubUser('repo'));
    const first = await addedTool(w, ihor, githubToken(CLASSIC_TOKEN, { label: 'Mine' }));
    w.clock.advance(60_000);
    w.provider.always(GITHUB_USER, githubUser('repo, workflow', 'ihor-renamed'));
    const res = await addTool(
      w,
      ihor,
      githubToken(FINE_TOKEN, { credentialId: first.id, label: 'ignored' }),
      'req-renew',
    );
    expect(res).toMatchObject({
      status: 201,
      body: {
        id: first.id,
        label: 'Mine',
        status: 'active',
        accountMeta: { login: 'ihor-renamed', tokenType: 'fine_grained' },
        checkedAt: w.clock().toISOString(),
      },
    });
    expect(await opened(first)).toMatchObject({ secret: { token: FINE_TOKEN } });
    const audit = await auditOfCredential(w.t.db, first.id);
    expect(
      audit.filter(([, , , request]) => request === 'req-renew').map(([action, field]) => [action, field]),
    ).toEqual([
      ['replace_secret', 'secret'],
      ['update', 'accountMeta'],
    ]);
    expect((await usesOf(w.t.db, first.id)).map((use) => use.purpose)).toEqual([
      'tool_check',
      'tool_check',
      'test',
    ]);
  });

  it('refuses another person’s (404), another kind (422), a revoked one (422), and keeps the old secret when the check fails', async () => {
    w.provider.always(GITHUB_USER, githubUser());
    const mine = await addedTool(w, ihor, githubToken());
    const theirs = await addedTool(w, other, githubToken());
    expect(await addTool(w, ihor, githubToken(FINE_TOKEN, { credentialId: theirs.id }))).toMatchObject({
      status: 404,
      body: { error: { code: 'credential_not_found' } },
    });
    expect(await addTool(w, ihor, atlassian({ credentialId: mine.id }))).toMatchObject({
      status: 422,
      body: { error: { code: 'tool_kind_mismatch' } },
    });
    w.provider.once(GITHUB_USER, status(401));
    expect(await addTool(w, ihor, githubToken(FINE_TOKEN, { credentialId: mine.id }))).toMatchObject({
      status: 422,
    });
    expect(await opened(mine)).toMatchObject({ secret: { token: CLASSIC_TOKEN } });
    await revokeSubscription(w.t.db, mine.id);
    expect(await addTool(w, ihor, githubToken(FINE_TOKEN, { credentialId: mine.id }))).toMatchObject({
      status: 422,
      body: { error: { code: 'credential_revoked' } },
    });
  });
});

describe('POST /api/me/subscriptions/:credentialId/check: Check again', () => {
  it('marks a 401 needs_sign_in, keeps it through a check that does not finish, and sets it active again', async () => {
    w.provider.always(GITHUB_USER, githubUser('repo'));
    const view = await addedTool(w, ihor, githubToken());
    w.clock.advance(60_000);
    w.provider.once(GITHUB_USER, status(401));
    expect(await checkAgainAs(ihor, view.id, 'req-check-1')).toMatchObject({
      status: 200,
      body: { status: 'needs_sign_in', checkError: null, checkedAt: w.clock().toISOString() },
    });
    w.provider.once(GITHUB_USER, status(503));
    expect(await checkAgainAs(ihor, view.id)).toMatchObject({
      status: 200,
      body: {
        status: 'needs_sign_in',
        checkError: { code: 'provider_unavailable', message: 'GitHub did not answer the last check.' },
      },
    });
    w.provider.once(GITHUB_USER, githubUser('repo, workflow'));
    const back = await checkAgainAs(ihor, view.id, 'req-check-3');
    expect(back).toMatchObject({
      status: 200,
      body: { status: 'active', checkError: null, accountMeta: { scopes: ['repo', 'workflow'] } },
    });
    expect((await usesOf(w.t.db, view.id)).map((use) => use.purpose)).toEqual([
      'tool_check',
      'tool_check',
      'tool_check',
      'tool_check',
    ]);
    const audit = await auditOfCredential(w.t.db, view.id);
    const updates = audit
      .filter(([action]) => action === 'update')
      .map(([, field, by, request]) => [field, by, request]);
    expect(updates.sort()).toEqual([
      ['accountMeta', 'user', 'req-check-3'],
      ['status', 'user', 'req-check-1'],
      ['status', 'user', 'req-check-3'],
    ]);
    noToolSecret(back.body);
  });

  it('checks an Atlassian sign-in again', async () => {
    w.provider.always(JIRA_MYSELF, jiraMyself).always(CONFLUENCE_CURRENT, status(404));
    const view = await addedTool(w, ihor, atlassian());
    w.provider.always(CONFLUENCE_CURRENT, confluenceCurrent);
    expect(await checkAgainAs(ihor, view.id)).toMatchObject({
      status: 200,
      body: { accountMeta: { jira: true, confluence: true } },
    });
  });

  it('refuses an AI subscription (422), another person’s sign-in (404) and a revoked one (422)', async () => {
    w.provider.always(GITHUB_USER, githubUser());
    const ai = await w.store.storeCredential({
      kind: 'claude_setup_token',
      secret: { token: 'sk-ant-oat01-FAKEsetupTOKEN' },
      label: 'Max',
      ownerUserId: ihor.userId,
    });
    expect(await checkAgainAs(ihor, ai.id)).toMatchObject({
      status: 422,
      body: { error: { code: 'not_a_tool' } },
    });
    const theirs = await addedTool(w, other, githubToken());
    for (const id of [theirs.id, '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b', 'not-an-id']) {
      expect(await checkAgainAs(ihor, id)).toMatchObject({ status: 404 });
    }
    const mine = await addedTool(w, ihor, githubToken());
    await revokeSubscription(w.t.db, mine.id);
    expect(await checkAgainAs(ihor, mine.id)).toMatchObject({
      status: 422,
      body: { error: { code: 'credential_revoked' } },
    });
  });
});

describe('tool sign-ins among the subscriptions', () => {
  it('are listed, renamed and removed with the subscriptions, but have no limits', async () => {
    w.provider.always(GITHUB_USER, githubUser());
    const person = await addUser(w.t.db, w.fake);
    const view = await addedTool(w, person, githubToken());
    const list = await call(w, person.token)('GET', '/api/me/subscriptions');
    expect((list.body as { subscriptions: SubscriptionView[] }).subscriptions.map((s) => s.id)).toEqual([
      view.id,
    ]);
    expect((await limitsOf(w, person)).size).toBe(0);
    const renamed = await call(w, person.token)('PATCH', `/api/me/subscriptions/${view.id}`, {
      label: 'Renamed',
    });
    expect(renamed).toMatchObject({ status: 200, body: { label: 'Renamed' } });
    expect(await call(w, person.token)('DELETE', `/api/me/subscriptions/${view.id}`)).toMatchObject({
      status: 204,
    });
    expect(await rowOf(w.t.db, view.id)).toBeUndefined();
    expect((await usesOf(w.t.db, view.id)).length).toBe(1);
  });

  it('never go in an access profile', async () => {
    w.provider.always(GITHUB_USER, githubUser());
    const view = await addedTool(w, ihor, githubToken());
    const profiles = call(w, ihor.token);
    expect(
      await profiles('POST', '/api/me/access-profiles', {
        name: 'Tools?',
        provider: 'claude',
        credentialId: view.id,
      }),
    ).toMatchObject({ status: 422, body: { error: { code: 'provider_mismatch' } } });
    expect(
      await profiles('POST', '/api/me/access-profiles', {
        name: 'Tools as gateway?',
        provider: 'claude',
        gatewayCredentialId: view.id,
      }),
    ).toMatchObject({ status: 422, body: { error: { code: 'credential_kind_mismatch' } } });
  });

  it('are managed only signed in: an API key is 403 session_required', async () => {
    w.provider.always(GITHUB_USER, githubUser());
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const added = await call(w, `fake:${person.subject}`)(
      'POST',
      '/api/me/subscriptions/tools',
      githubToken(),
    );
    expect(added.status).toBe(201);
    const id = (added.body as SubscriptionView).id;
    for (const [path, body] of [
      ['/api/me/subscriptions/tools', githubToken()],
      [`/api/me/subscriptions/${id}/check`, undefined],
    ] as const) {
      expect(await call(w, key)('POST', path, body)).toMatchObject({
        status: 403,
        body: { error: { code: 'session_required' } },
      });
    }
    expect(w.provider.calls).toHaveLength(1);
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, id));
    expect(row?.checkedAt).toEqual(w.clock());
  });
});

const checkAgainAs = (user: LinkedUser, id: string, requestId?: string) => checkAgain(w, user, id, requestId);
