import { defaultRights } from '@mwc/shared/credentials';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { addSignIn, auditRows, noSecret, PROFILES, SLACK_BOT_SCOPES } from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

// A profile's Slack part (S7.1e, docs/subscriptions.md "Slack"): one of the owner's Slack sign-ins and its rights, safe
// by default (read every channel, post nowhere), shown with the workspace, bot or user and the token's scopes; a right a
// request turns on that the token's scopes do not allow is refused (422 `slack_scope_missing`).

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

let names = 0;
const as = (requestId?: string) => call(w, ihor.token, requestId);
const post = (body: Record<string, unknown>) => as()('POST', PROFILES, { name: `Slack ${++names}`, ...body });
const patch = (id: string, body: Record<string, unknown>, requestId?: string) =>
  as(requestId)('PATCH', `${PROFILES}/${id}`, body);

const POST_IN_GENERAL = {
  read: true,
  post: true,
  channels: ['general', 'C0123ABCD'],
  dms: 'off',
  search: false,
  react: false,
};

describe('a profile’s Slack part', () => {
  it('holds a bot sign-in with safe rights by default, shown with its workspace, bot and scopes', async () => {
    const bot = await addSignIn(w, keyring, ihor.userId, 'slack_bot_token');
    const res = await post({ parts: { slack: { credentialId: bot.id } } });
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view.parts.slack).toEqual({
      signIn: expect.objectContaining({
        id: bot.id,
        kind: 'slack_bot_token',
        account: 'mw-bot',
        site: 'Airia Fake',
        asUser: false,
        scopes: SLACK_BOT_SCOPES,
      }),
      rights: defaultRights('slack'),
    });
    expect(view.parts).toMatchObject({ claude: null, github: null, atlassian: null });
    noSecret(res.body);
  });

  it('takes rights as a whole set, channels by name or id, audited; a user token shows it posts as its person', async () => {
    const user = await addSignIn(w, keyring, ihor.userId, 'slack_user_token');
    const profile = (await post({ parts: { slack: { credentialId: user.id } } })).body as AccessProfileView;
    expect(profile.parts.slack?.signIn).toMatchObject({ account: 'ihor', asUser: true });
    const rights = { ...POST_IN_GENERAL, channels: ['#General', 'C0123ABCD'], search: true, dms: 'post' };
    const res = await patch(profile.id, { parts: { slack: { rights } } }, 'req-slack-rights');
    expect(res.status).toBe(200);
    const saved = { ...POST_IN_GENERAL, search: true, dms: 'post' };
    expect((res.body as AccessProfileView).parts.slack?.rights).toEqual(saved);
    const audit = (await auditRows(w.t.db, 'access_profile', profile.id)).filter(
      (row) => row.requestId === 'req-slack-rights',
    );
    expect(audit.map((row) => [row.field, row.newValue])).toEqual([['slackRights', saved]]);
  });

  it('refuses a right the token’s scopes do not allow, naming what it lacks', async () => {
    const bot = await addSignIn(w, keyring, ihor.userId, 'slack_bot_token');
    const profile = (await post({ parts: { slack: { credentialId: bot.id } } })).body as AccessProfileView;
    const search = await patch(profile.id, {
      parts: { slack: { rights: { ...POST_IN_GENERAL, search: true } } },
    });
    expect(search).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'slack_scope_missing',
          message:
            'Search needs a user token (xoxp-) with search:read, which this Slack sign-in lacks: add a user token with it',
        },
      },
    });
    const made = await post({
      parts: { slack: { credentialId: bot.id, rights: { ...POST_IN_GENERAL, search: true } } },
    });
    expect(made).toMatchObject({ status: 422, body: { error: { code: 'slack_scope_missing' } } });
    expect(await patch(profile.id, { parts: { slack: { rights: POST_IN_GENERAL } } })).toMatchObject({
      status: 200,
    });
  });

  it('takes rights with no sign-in yet, and removes the part with its columns', async () => {
    const profile = (await post({ parts: { slack: { rights: { ...POST_IN_GENERAL, react: true } } } }))
      .body as AccessProfileView;
    expect(profile.parts.slack).toEqual({ signIn: null, rights: { ...POST_IN_GENERAL, react: true } });
    const removed = await patch(profile.id, { parts: { slack: null } });
    expect((removed.body as AccessProfileView).parts.slack).toBeNull();
  });

  it('refuses another tool’s sign-in, and rights of another shape', async () => {
    const github = await addSignIn(w, keyring, ihor.userId, 'github_token');
    expect(await post({ parts: { slack: { credentialId: github.id } } })).toMatchObject({
      status: 422,
      body: { error: { code: 'credential_kind_mismatch' } },
    });
    const shape = await post({
      parts: { slack: { rights: { repos: 'all', push: false, pullRequests: false } } },
    });
    expect(shape.status).toBe(400);
  });
});
