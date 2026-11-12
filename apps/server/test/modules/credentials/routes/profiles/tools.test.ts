import { defaultRights } from '@mwc/shared/credentials';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import {
  addSignIn,
  addSubscription,
  auditRows,
  noSecret,
  PROFILES,
  revokeSubscription,
} from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// Tool profiles (S7.1b, docs/subscriptions.md "Tool profiles"): a GitHub or Atlassian profile holds one of its owner's
// sign-ins of that tool (never an AI subscription, nor a tool sign-in in an AI profile, nor a revoked one) and the rights
// its agents have there, with no gateway, model or effort; its rights start at the safe end and change as a whole.

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const as = (user: LinkedUser, requestId?: string) => call(w, user.token, requestId);
let names = 0;
const post = (body: Record<string, unknown>, user = ihor, requestId?: string) =>
  as(user, requestId)('POST', PROFILES, { name: `Tool ${++names}`, ...body });
const patch = (id: string, body: Record<string, unknown>, requestId?: string) =>
  as(ihor, requestId)('PATCH', `${PROFILES}/${id}`, body);
const refusal = (status: number, code: string) => ({ status, body: { error: { code } } });

const PUSH = { repos: ['AiriaLLC/*', 'abibas/virtual-company-v2'], push: true, pullRequests: true };
const JIRA = { jira: 'changes', jiraProjects: ['AP'], confluence: 'write', confluenceSpaces: ['ENG'] };

describe('making a tool profile', () => {
  it('holds a GitHub sign-in with the safe defaults, shown with its account, and audits its rights', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const res = await post(
      { name: 'AiriaLLC', provider: 'github', credentialId: signIn.id },
      ihor,
      'req-gh-1',
    );
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view).toMatchObject({
      name: 'AiriaLLC',
      provider: 'github',
      subscription: {
        id: signIn.id,
        kind: 'github_oauth',
        account: 'ihor-fake',
        site: null,
        status: 'active',
      },
      gateway: null,
      model: null,
      effort: null,
      rights: { repos: [], push: false, pullRequests: false },
      agents: [],
    });
    noSecret(view);
    const audit = (await auditRows(w.t.db, 'access_profile', view.id)).map((row) => [
      row.field,
      row.newValue,
    ]);
    expect(audit).toContainEqual(['rights', defaultRights('github')]);
    expect(audit).toContainEqual(['provider', 'github']);
    expect(audit.map(([field]) => field)).not.toContain('model');
  });

  it('holds an Atlassian sign-in with the rights given, shown with its name and site', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    const res = await post({ provider: 'atlassian', credentialId: signIn.id, rights: JIRA });
    expect(res).toMatchObject({
      status: 201,
      body: {
        provider: 'atlassian',
        subscription: {
          account: 'Ihor Herasko',
          site: 'airia-fake.atlassian.net',
          accountEmail: 'ihor@example.test',
        },
        rights: JIRA,
      },
    });
    const empty = await post({ provider: 'atlassian' });
    expect(empty).toMatchObject({
      status: 201,
      body: { subscription: null, rights: defaultRights('atlassian') },
    });
  });

  it('refuses an AI subscription in a tool profile, a tool sign-in in an AI one, and the other tool’s sign-in', async () => {
    const claude = await addSubscription(w, keyring, ihor.userId, 'claude_setup_token');
    const github = await addSignIn(w, keyring, ihor.userId, 'github_token');
    const atlassian = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    for (const [provider, credentialId] of [
      ['github', claude.id],
      ['claude', github.id],
      ['openai', atlassian.id],
      ['github', atlassian.id],
      ['atlassian', github.id],
    ] as const) {
      expect(await post({ provider, credentialId }), `${provider} ${credentialId}`).toMatchObject(
        refusal(422, 'provider_mismatch'),
      );
    }
    expect(await post({ provider: 'claude', gatewayCredentialId: github.id })).toMatchObject(
      refusal(422, 'credential_kind_mismatch'),
    );
  });

  it('refuses a revoked sign-in and someone else’s', async () => {
    const revoked = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    await revokeSubscription(w.t.db, revoked.id);
    expect(await post({ provider: 'github', credentialId: revoked.id })).toMatchObject(
      refusal(422, 'credential_revoked'),
    );
    const theirs = await addSignIn(w, keyring, other.userId, 'github_oauth');
    expect(await post({ provider: 'github', credentialId: theirs.id })).toMatchObject(
      refusal(422, 'credential_not_found'),
    );
  });

  it('refuses a gateway, a model or an effort on a tool profile, and rights on an AI one or of the other tool', async () => {
    const gateway = await addSubscription(w, keyring, ihor.userId, 'gateway');
    for (const extra of [
      { gatewayCredentialId: gateway.id },
      { model: 'claude-opus-5-5' },
      { effort: 'high' },
    ]) {
      expect(await post({ provider: 'github', ...extra })).toMatchObject(
        refusal(422, 'not_for_tool_profile'),
      );
    }
    expect(await post({ provider: 'claude', rights: PUSH })).toMatchObject(
      refusal(422, 'rights_not_for_ai_profile'),
    );
    expect(await post({ provider: 'github', rights: JIRA })).toMatchObject(
      refusal(422, 'rights_provider_mismatch'),
    );
  });

  it('refuses rights of no tool’s shape, a merge right among them (400)', async () => {
    for (const rights of [
      { ...PUSH, merge: true },
      { ...PUSH, repos: ['not a repo'] },
      { repos: 'all', push: true },
      { ...JIRA, jira: 'write' },
      { ...JIRA, delete: true },
    ]) {
      expect(await post({ provider: 'github', rights }), JSON.stringify(rights)).toMatchObject(
        refusal(400, 'invalid_request'),
      );
    }
  });
});

describe('changing a tool profile', () => {
  it('replaces its rights as a whole and audits the change; the same rights again write nothing', async () => {
    const made = (await post({ provider: 'github' })).body as AccessProfileView;
    const res = await patch(
      made.id,
      { rights: { ...PUSH, repos: [' AiriaLLC/* ', 'airiallc/*'] } },
      'req-rights',
    );
    expect(res).toMatchObject({ status: 200, body: { rights: { ...PUSH, repos: ['AiriaLLC/*'] } } });
    const again = await patch(made.id, { rights: { pullRequests: true, push: true, repos: ['AiriaLLC/*'] } });
    expect(again.status).toBe(200);
    const rows = (await auditRows(w.t.db, 'access_profile', made.id)).filter(
      (row) => row.action === 'update',
    );
    expect(rows.map((row) => [row.field, row.requestId, row.oldValue, row.newValue])).toEqual([
      ['rights', 'req-rights', defaultRights('github'), { ...PUSH, repos: ['AiriaLLC/*'] }],
    ]);
  });

  it('takes a sign-in of its tool, never another provider, a gateway, a model or the other tool’s rights', async () => {
    const made = (await post({ provider: 'atlassian' })).body as AccessProfileView;
    const signIn = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    expect(await patch(made.id, { credentialId: signIn.id })).toMatchObject({
      status: 200,
      body: { subscription: { id: signIn.id, account: 'Ihor Herasko' } },
    });
    expect(await patch(made.id, { provider: 'github' })).toMatchObject(refusal(422, 'provider_mismatch'));
    expect(await patch(made.id, { effort: 'max' })).toMatchObject(refusal(422, 'not_for_tool_profile'));
    expect(await patch(made.id, { rights: PUSH })).toMatchObject(refusal(422, 'rights_provider_mismatch'));
    const claude = await addSubscription(w, keyring, ihor.userId, 'claude_oauth');
    expect(await patch(made.id, { credentialId: claude.id })).toMatchObject(
      refusal(422, 'provider_mismatch'),
    );
    expect(
      await patch(made.id, { credentialId: null, gatewayCredentialId: null, model: null }),
    ).toMatchObject({
      status: 200,
      body: { subscription: null },
    });
  });

  it('refuses rights on an AI profile', async () => {
    const claude = (await post({ provider: 'claude' })).body as AccessProfileView;
    expect(await patch(claude.id, { rights: PUSH })).toMatchObject(refusal(422, 'rights_not_for_ai_profile'));
  });

  it('lists tool profiles with the AI ones, each with its rights (null for an AI one)', async () => {
    const res = await as(ihor)('GET', PROFILES);
    const profiles = (res.body as { profiles: AccessProfileView[] }).profiles;
    expect(new Set(profiles.map((profile) => profile.provider))).toEqual(
      new Set(['github', 'atlassian', 'claude']),
    );
    for (const profile of profiles) expect(profile.rights === null).toBe(profile.provider === 'claude');
    noSecret(res.body);
  });
});
