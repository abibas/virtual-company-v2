import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubscriptionView } from '../../../../../src/modules/credentials/schemas.ts';
import { addUser, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { type LimitsWorld, limitsWorld, usesOf } from '../../../../fixtures/credentials/providers.ts';
import {
  addedTool,
  addTool,
  auditOfCredential,
  checkAgain,
  noToolSecret,
  rowOf,
  SLACK_AUTH_TEST,
  SLACK_BOT_TOKEN,
  SLACK_USER_TOKEN,
  slackAuth,
  slackRefusal,
  slackToken,
} from '../../../../fixtures/credentials/tools.ts';

/** A Slack sign-in (S7.1e): one form, a bot's or a user's token by its prefix, checked with `auth.test`. */

let w: LimitsWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await limitsWorld();
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());
beforeEach(() => w.provider.reset());

const opened = (view: SubscriptionView) => w.store.useCredentialSecret(view.id, ihor.userId, 'test');

describe('POST /api/me/subscriptions/tools: a Slack token', () => {
  it('stores a bot token as slack_bot_token with its workspace, bot and scopes, never shown again', async () => {
    w.provider.always(SLACK_AUTH_TEST, slackAuth('bot', 'channels:read,channels:history,chat:write'));
    const res = await addTool(w, ihor, slackToken(), 'req-slack-1');
    expect(res.status).toBe(201);
    const view = res.body as SubscriptionView;
    expect(view).toMatchObject({
      kind: 'slack_bot_token',
      label: 'Slack · Airia Fake',
      accountEmail: null,
      accountMeta: {
        team: 'Airia Fake',
        teamId: 'T0FAKE',
        url: 'https://airia-fake.slack.com/',
        user: 'mw-bot',
        userId: 'U0BOT',
        botId: 'B0BOT',
        scopes: ['channels:read', 'channels:history', 'chat:write'],
      },
      status: 'active',
      checkedAt: w.clock().toISOString(),
      checkError: null,
    });
    expect(w.provider.callsTo(SLACK_AUTH_TEST)).toHaveLength(1);
    noToolSecret(res.body);
    noToolSecret(await rowOf(w.t.db, view.id));
    expect((await usesOf(w.t.db, view.id)).map((use) => use.purpose)).toEqual(['tool_check']);
    expect(
      (await auditOfCredential(w.t.db, view.id)).every(
        ([action, , by, request]) => action === 'create' && by === 'user' && request === 'req-slack-1',
      ),
    ).toBe(true);
    expect(await opened(view)).toMatchObject({
      ok: true,
      kind: 'slack_bot_token',
      secret: { token: SLACK_BOT_TOKEN },
    });
  });

  it('stores a user token as slack_user_token, under the name given', async () => {
    w.provider.always(SLACK_AUTH_TEST, slackAuth('user', 'search:read'));
    const view = await addedTool(w, ihor, slackToken(` ${SLACK_USER_TOKEN} `, { label: 'Me in Slack' }));
    expect(view).toMatchObject({
      kind: 'slack_user_token',
      label: 'Me in Slack',
      accountMeta: { user: 'ihor', scopes: ['search:read'] },
    });
    expect(view.accountMeta).not.toHaveProperty('botId');
  });

  it('stores nothing when Slack refuses the token (422) or does not answer (502)', async () => {
    const before = (await rawDb(w.t.db).select().from(credentials)).length;
    w.provider
      .once(SLACK_AUTH_TEST, slackRefusal('invalid_auth'))
      .once(SLACK_AUTH_TEST, slackRefusal('fatal_error'));
    expect(await addTool(w, ihor, slackToken())).toMatchObject({
      status: 422,
      body: { error: { code: 'tool_sign_in_refused', message: 'Slack did not accept this token.' } },
    });
    expect(await addTool(w, ihor, slackToken())).toMatchObject({
      status: 502,
      body: { error: { code: 'provider_unavailable', message: 'Slack did not answer. Try again.' } },
    });
    expect((await rawDb(w.t.db).select().from(credentials)).length).toBe(before);
  });

  it.each([
    ['an app-level token', slackToken('xapp-1-FAKE')],
    ['a legacy token', slackToken('xoxa-2-FAKE')],
    ['spaces inside', slackToken('xoxb-1 FAKE')],
    ['other characters', slackToken('xoxb-1_FAKE')],
    ['no token', { kind: 'slack' }],
  ])('refuses %s with 400 before asking Slack', async (_, body) => {
    expect(await addTool(w, ihor, body)).toMatchObject({ status: 400 });
    expect(w.provider.calls).toEqual([]);
  });
});

describe('a Slack sign-in again, and Check again', () => {
  it('renews a bot token in place, and refuses a user token for it (another kind)', async () => {
    w.provider.always(SLACK_AUTH_TEST, slackAuth('bot', 'chat:write'));
    const first = await addedTool(w, ihor, slackToken());
    const renewed = await addTool(w, ihor, slackToken('xoxb-2-FAKEnewBOTtoken', { credentialId: first.id }));
    expect(renewed).toMatchObject({ status: 201, body: { id: first.id, kind: 'slack_bot_token' } });
    expect(await opened(first)).toMatchObject({ secret: { token: 'xoxb-2-FAKEnewBOTtoken' } });
    const mismatch = await addTool(w, ihor, slackToken(SLACK_USER_TOKEN, { credentialId: first.id }));
    expect(mismatch).toMatchObject({ status: 422, body: { error: { code: 'tool_kind_mismatch' } } });
  });

  it('keeps new scopes on Check again, and marks a revoked token needs_sign_in', async () => {
    w.provider.always(SLACK_AUTH_TEST, slackAuth('bot', 'chat:write'));
    const view = await addedTool(w, ihor, slackToken());
    w.provider.always(SLACK_AUTH_TEST, slackAuth('bot', 'chat:write,reactions:write'));
    expect(await checkAgain(w, ihor, view.id)).toMatchObject({
      status: 200,
      body: { status: 'active', accountMeta: { scopes: ['chat:write', 'reactions:write'] } },
    });
    w.provider.always(SLACK_AUTH_TEST, slackRefusal('token_revoked'));
    expect(await checkAgain(w, ihor, view.id)).toMatchObject({
      status: 200,
      body: { status: 'needs_sign_in' },
    });
    w.provider.always(SLACK_AUTH_TEST, slackRefusal('ratelimited'));
    expect(await checkAgain(w, ihor, view.id)).toMatchObject({
      status: 200,
      body: {
        status: 'needs_sign_in',
        checkError: { code: 'rate_limited', message: 'Slack rate limited the last check.' },
      },
    });
  });
});
