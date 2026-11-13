import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { defaultRights } from '@mwc/shared/credentials';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { as as asPerson, membersCompany } from '../../../../fixtures/members/members.ts';
import {
  addSignIn,
  addSubscription,
  auditRows,
  makeAgent,
  noSecret,
  PROFILES,
  profileToolsOf,
  revokeSubscription,
} from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// A profile's tool parts (S7.1b, generic profiles since 2026-11-13, docs/subscriptions.md "Profiles"): a GitHub and an
// Atlassian part, each one of the owner's sign-ins of that tool (never another kind, someone else's or a revoked one)
// and the rights its agents have there, added, changed and removed by `parts`; and never removing an AI part agents
// run on.

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
  as(ihor, requestId)('POST', PROFILES, { name: `Full ${++names}`, ...body });
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
    expect((await made()).parts).toEqual({ claude: null, openai: null, github: null, atlassian: null });
  });

  it('hold a sign-in of each tool with its rights, shown with the account and site, audited, never a secret', async () => {
    const github = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const atlassian = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    const res = await post(
      {
        parts: {
          github: { credentialId: github.id, rights: PUSH },
          atlassian: { credentialId: atlassian.id },
        },
      },
      'req-parts-1',
    );
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view.parts).toMatchObject({
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
    expect((await made({ parts: { github: {} } })).parts).toMatchObject({
      github: { signIn: null, rights: defaultRights('github') },
      atlassian: null,
    });
  });
});

describe('changing a profile’s tool parts', () => {
  it('adds a part, changes its sign-in and its rights as a whole, and audits only what differs', async () => {
    const profile = await made();
    const signIn = await addSignIn(w, keyring, ihor.userId, 'github_token');
    const added = await patch(profile.id, { parts: { github: { credentialId: signIn.id } } }, 'req-add');
    expect(added).toMatchObject({
      status: 200,
      body: {
        parts: {
          github: { signIn: { id: signIn.id, account: 'ihor-pat' }, rights: defaultRights('github') },
        },
      },
    });
    const normalised = { ...PUSH, repos: [' AiriaLLC/* ', 'airiallc/*'] };
    const changed = await patch(profile.id, { parts: { github: { rights: normalised } } }, 'req-rights');
    expect(changed).toMatchObject({
      status: 200,
      body: { parts: { github: { rights: { ...PUSH, repos: ['AiriaLLC/*'] } } } },
    });
    const again = {
      parts: { github: { rights: { pullRequests: true, push: true, repos: ['AiriaLLC/*'] } } },
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
    const profile = await made({ parts: { atlassian: { credentialId: signIn.id, rights: WIKI } } });
    const res = await patch(profile.id, { parts: { atlassian: null, github: null } }, 'req-off');
    expect(res).toMatchObject({ status: 200, body: { parts: { github: null, atlassian: null } } });
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
    const profile = await made({ parts: { github: { credentialId: signIn.id, rights: PUSH } } });
    await rawDb(w.t.db).delete(credentials).where(eq(credentials.id, signIn.id));
    const list = ((await as(ihor)('GET', PROFILES)).body as { profiles: AccessProfileView[] }).profiles;
    expect(list.find((p) => p.id === profile.id)?.parts.github).toEqual({ signIn: null, rights: PUSH });
  });

  it('keeps a sign-in revoked while in place until it is replaced', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const profile = await made({ parts: { github: { credentialId: signIn.id } } });
    await revokeSubscription(w.t.db, signIn.id);
    const res = await patch(profile.id, { parts: { github: { credentialId: signIn.id, rights: PUSH } } });
    expect(res).toMatchObject({
      status: 200,
      body: { parts: { github: { signIn: { status: 'revoked' } } } },
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
      expect(await post({ parts: tools }), JSON.stringify(tools)).toMatchObject(
        refusal(422, 'credential_kind_mismatch'),
      );
    }
    const profile = await made();
    expect(await patch(profile.id, { parts: { atlassian: { credentialId: claude.id } } })).toMatchObject(
      refusal(422, 'credential_kind_mismatch'),
    );
  });

  it('a tool sign-in as an AI part’s subscription or gateway', async () => {
    const github = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    for (const parts of [
      { claude: { credentialId: github.id } },
      { openai: { credentialId: github.id } },
      { claude: { gatewayCredentialId: github.id } },
    ]) {
      expect(await post({ parts })).toMatchObject(refusal(422, 'credential_kind_mismatch'));
    }
  });

  it('a revoked sign-in, and someone else’s', async () => {
    const revoked = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    await revokeSubscription(w.t.db, revoked.id);
    expect(await post({ parts: { github: { credentialId: revoked.id } } })).toMatchObject(
      refusal(422, 'credential_revoked'),
    );
    const theirs = await addSignIn(w, keyring, other.userId, 'atlassian_api_token');
    expect(await post({ parts: { atlassian: { credentialId: theirs.id } } })).toMatchObject(
      refusal(422, 'credential_not_found'),
    );
  });

  it('rights of the other tool or of no tool’s shape, and unknown parts and keys (400)', async () => {
    for (const body of [
      { parts: { github: { rights: WIKI } } },
      { parts: { atlassian: { rights: PUSH } } },
      { parts: { github: { rights: { ...PUSH, merge: true } } } },
      { parts: { github: { rights: { ...PUSH, repos: ['not a repo'] } } } },
      { parts: { atlassian: { rights: { ...WIKI, delete: true } } } },
      { parts: { github: { credentialId: null, push: true } } },
      { parts: { slack: {} } },
      { parts: { github: { model: 'x' } } },
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
    expect(profiles.some((profile) => profile.parts.github !== null)).toBe(true);
    expect(profiles.some((profile) => profile.parts.atlassian !== null)).toBe(true);
    noSecret(res.body);
  });
});

describe('removing a part agents use', () => {
  it('refuses an AI part agents run on, naming them, and takes a tool part off', async () => {
    const company = await membersCompany(w);
    const owner = company.owner;
    const signIn = await addSignIn(w, keyring, owner.userId, 'github_oauth');
    const res = await asPerson(w, owner)('POST', PROFILES, {
      name: 'In use',
      parts: { claude: {}, github: { credentialId: signIn.id } },
    });
    const profile = res.body as AccessProfileView;
    for (const name of ['Developer', 'QA'])
      await makeAgent(w, company, owner, { name, profileId: profile.id });
    const path = `${PROFILES}/${profile.id}`;
    const refused = await asPerson(w, owner)('PATCH', path, { parts: { claude: null } });
    expect(refused).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'profile_part_in_use',
          message: "Developer and QA run on this profile's Claude part: give them another profile first",
        },
      },
    });
    const kept = await asPerson(w, owner)('PATCH', path, { parts: { openai: null, github: null } });
    expect(kept).toMatchObject({ status: 200, body: { parts: { openai: null, github: null, claude: {} } } });
    const swap = await asPerson(w, owner)('PATCH', path, { parts: { claude: null, openai: {} } });
    expect(swap).toMatchObject({ status: 422, body: { error: { code: 'profile_part_in_use' } } });
  });
});
