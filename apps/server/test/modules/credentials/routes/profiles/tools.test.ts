import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { defaultRights } from '@mwc/shared/credentials';
import { eq } from 'drizzle-orm';
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
  profileToolsOf,
  revokeSubscription,
} from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// A profile's tool parts (S7.1b, one profile with tool parts since 2026-11-13, docs/subscriptions.md "Tool parts"): a
// GitHub and an Atlassian part beside the AI part, each one of the owner's sign-ins of that tool (never another kind,
// someone else's or a revoked one) and the rights its agents have there; added, changed and removed by `tools`.

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
const post = (body: Record<string, unknown>, requestId?: string) =>
  as(ihor, requestId)('POST', PROFILES, { name: `Full ${++names}`, provider: 'claude', ...body });
const patch = (id: string, body: Record<string, unknown>, requestId?: string) =>
  as(ihor, requestId)('PATCH', `${PROFILES}/${id}`, body);
const made = async (body: Record<string, unknown> = {}) => (await post(body)).body as AccessProfileView;
const refusal = (status: number, code: string) => ({ status, body: { error: { code } } });
const updates = async (id: string) =>
  (await auditRows(w.t.db, 'access_profile', id))
    .filter((row) => row.action === 'update')
    .map((row) => [row.field, row.requestId, row.oldValue, row.newValue]);

const PUSH = { repos: ['AiriaLLC/*', 'abibas/virtual-company-v2'], push: true, pullRequests: true };
const WIKI = { jira: 'changes', jiraProjects: ['AP'], confluence: 'write', confluenceSpaces: ['ENG'] };

describe('a profile’s tool parts when it is made', () => {
  it('are none unless given', async () => {
    expect((await made()).tools).toEqual({ github: null, atlassian: null });
  });

  it('hold a sign-in of each tool with its rights, shown with the account and site, audited, never a secret', async () => {
    const github = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const atlassian = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    const res = await post(
      {
        tools: {
          github: { credentialId: github.id, rights: PUSH },
          atlassian: { credentialId: atlassian.id },
        },
      },
      'req-tools-1',
    );
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view.tools).toEqual({
      github: {
        signIn: expect.objectContaining({
          id: github.id,
          kind: 'github_oauth',
          account: 'ihor-fake',
          site: null,
        }),
        rights: PUSH,
      },
      atlassian: {
        signIn: expect.objectContaining({
          id: atlassian.id,
          account: 'Ihor Herasko',
          site: 'airia-fake.atlassian.net',
          accountEmail: 'ihor@example.test',
        }),
        rights: defaultRights('atlassian'),
      },
    });
    noSecret(view);
    const audit = (await auditRows(w.t.db, 'access_profile', view.id)).map((row) => [
      row.field,
      row.newValue,
    ]);
    expect(audit).toEqual(
      expect.arrayContaining([
        ['githubCredentialId', github.id],
        ['githubRights', PUSH],
        ['atlassianCredentialId', atlassian.id],
        ['atlassianRights', defaultRights('atlassian')],
      ]),
    );
  });

  it('may have a part with no sign-in yet', async () => {
    expect((await made({ tools: { github: {} } })).tools).toEqual({
      github: { signIn: null, rights: defaultRights('github') },
      atlassian: null,
    });
  });
});

describe('changing a profile’s tool parts', () => {
  it('adds a part, changes its sign-in and its rights as a whole, and audits only what differs', async () => {
    const profile = await made();
    const signIn = await addSignIn(w, keyring, ihor.userId, 'github_token');
    const added = await patch(profile.id, { tools: { github: { credentialId: signIn.id } } }, 'req-add');
    expect(added).toMatchObject({
      status: 200,
      body: {
        tools: {
          github: { signIn: { id: signIn.id, account: 'ihor-pat' }, rights: defaultRights('github') },
        },
      },
    });
    const normalised = { ...PUSH, repos: [' AiriaLLC/* ', 'airiallc/*'] };
    const changed = await patch(profile.id, { tools: { github: { rights: normalised } } }, 'req-rights');
    expect(changed).toMatchObject({
      status: 200,
      body: { tools: { github: { rights: { ...PUSH, repos: ['AiriaLLC/*'] } } } },
    });
    const again = {
      tools: { github: { rights: { pullRequests: true, push: true, repos: ['AiriaLLC/*'] } } },
    };
    expect((await patch(profile.id, again)).status).toBe(200);
    expect(await updates(profile.id)).toEqual([
      ['githubCredentialId', 'req-add', null, signIn.id],
      ['githubRights', 'req-add', null, defaultRights('github')],
      ['githubRights', 'req-rights', defaultRights('github'), { ...PUSH, repos: ['AiriaLLC/*'] }],
    ]);
  });

  it('removes a part with null, its sign-in staying in the store; removing one it has not writes nothing', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    const profile = await made({ tools: { atlassian: { credentialId: signIn.id, rights: WIKI } } });
    const res = await patch(profile.id, { tools: { atlassian: null, github: null } }, 'req-off');
    expect(res).toMatchObject({ status: 200, body: { tools: { github: null, atlassian: null } } });
    expect(await profileToolsOf(w.t.db, profile.id)).toEqual({
      githubCredentialId: null,
      githubRights: null,
      atlassianCredentialId: null,
      atlassianRights: null,
    });
    expect(await updates(profile.id)).toEqual([
      ['atlassianCredentialId', 'req-off', signIn.id, null],
      ['atlassianRights', 'req-off', WIKI, null],
    ]);
    const store = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, signIn.id));
    expect(store).toHaveLength(1);
  });

  it('keeps a part whose sign-in is removed from the store, with no sign-in', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const profile = await made({ tools: { github: { credentialId: signIn.id, rights: PUSH } } });
    await rawDb(w.t.db).delete(credentials).where(eq(credentials.id, signIn.id));
    const list = ((await as(ihor)('GET', PROFILES)).body as { profiles: AccessProfileView[] }).profiles;
    expect(list.find((p) => p.id === profile.id)?.tools.github).toEqual({ signIn: null, rights: PUSH });
  });

  it('keeps a sign-in revoked while in place until it is replaced', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const profile = await made({ tools: { github: { credentialId: signIn.id } } });
    await revokeSubscription(w.t.db, signIn.id);
    const res = await patch(profile.id, { tools: { github: { credentialId: signIn.id, rights: PUSH } } });
    expect(res).toMatchObject({
      status: 200,
      body: { tools: { github: { signIn: { status: 'revoked' } } } },
    });
  });
});

describe('what a tool part refuses', () => {
  it('a sign-in of another kind: an AI subscription, a gateway or the other tool’s (422)', async () => {
    const claude = await addSubscription(w, keyring, ihor.userId, 'claude_setup_token');
    const gateway = await addSubscription(w, keyring, ihor.userId, 'gateway');
    const atlassian = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    const github = await addSignIn(w, keyring, ihor.userId, 'github_token');
    for (const tools of [
      { github: { credentialId: claude.id } },
      { github: { credentialId: gateway.id } },
      { github: { credentialId: atlassian.id } },
      { atlassian: { credentialId: github.id } },
    ]) {
      expect(await post({ tools }), JSON.stringify(tools)).toMatchObject(
        refusal(422, 'credential_kind_mismatch'),
      );
    }
    const profile = await made();
    expect(await patch(profile.id, { tools: { atlassian: { credentialId: claude.id } } })).toMatchObject(
      refusal(422, 'credential_kind_mismatch'),
    );
  });

  it('a tool sign-in as the subscription or the gateway', async () => {
    const github = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    expect(await post({ credentialId: github.id })).toMatchObject(refusal(422, 'provider_mismatch'));
    expect(await post({ provider: 'openai', credentialId: github.id })).toMatchObject(
      refusal(422, 'provider_mismatch'),
    );
    expect(await post({ gatewayCredentialId: github.id })).toMatchObject(
      refusal(422, 'credential_kind_mismatch'),
    );
  });

  it('a revoked sign-in, and someone else’s', async () => {
    const revoked = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    await revokeSubscription(w.t.db, revoked.id);
    expect(await post({ tools: { github: { credentialId: revoked.id } } })).toMatchObject(
      refusal(422, 'credential_revoked'),
    );
    const theirs = await addSignIn(w, keyring, other.userId, 'atlassian_api_token');
    expect(await post({ tools: { atlassian: { credentialId: theirs.id } } })).toMatchObject(
      refusal(422, 'credential_not_found'),
    );
  });

  it('rights of the other tool or of no tool’s shape, unknown parts and keys, and a tool provider (400)', async () => {
    for (const body of [
      { tools: { github: { rights: WIKI } } },
      { tools: { atlassian: { rights: PUSH } } },
      { tools: { github: { rights: { ...PUSH, merge: true } } } },
      { tools: { github: { rights: { ...PUSH, repos: ['not a repo'] } } } },
      { tools: { atlassian: { rights: { ...WIKI, delete: true } } } },
      { tools: { github: { credentialId: null, push: true } } },
      { tools: { slack: {} } },
      { provider: 'github' },
    ]) {
      const res = await post(body);
      expect(res, JSON.stringify(body)).toMatchObject(refusal(400, 'invalid_request'));
    }
  });
});

describe('the list', () => {
  it('shows every profile with its tool parts, never a secret', async () => {
    const res = await as(ihor)('GET', PROFILES);
    const profiles = (res.body as { profiles: AccessProfileView[] }).profiles;
    expect(profiles.some((profile) => profile.tools.github !== null)).toBe(true);
    expect(profiles.some((profile) => profile.tools.atlassian !== null)).toBe(true);
    noSecret(res.body);
  });
});
