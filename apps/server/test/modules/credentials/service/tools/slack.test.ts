import { describe, expect, it } from 'vitest';
import { TOOL_USER_AGENT } from '../../../../../src/modules/credentials/service/tools/github.ts';
import {
  checkSlack,
  SLACK_AUTH_TEST_URL,
} from '../../../../../src/modules/credentials/service/tools/slack.ts';
import { FakeProvider, json } from '../../../../fixtures/credentials/providers.ts';
import {
  SLACK_AUTH_TEST,
  SLACK_BOT_TOKEN,
  SLACK_USER_TOKEN,
  slackAuth,
  slackRefusal,
  status,
} from '../../../../fixtures/credentials/tools.ts';

const bot = { token: SLACK_BOT_TOKEN };

describe('checkSlack', () => {
  it('asks auth.test with the token as the bearer, no redirects and a deadline, and keeps the workspace and scopes', async () => {
    const provider = new FakeProvider().always(
      SLACK_AUTH_TEST,
      slackAuth('bot', 'chat:write, channels:read'),
    );
    expect(SLACK_AUTH_TEST_URL).toBe(SLACK_AUTH_TEST);
    expect(await checkSlack(provider.fetch, 'slack_bot_token', bot)).toEqual({
      ok: true,
      accountEmail: null,
      accountMeta: {
        team: 'Airia Fake',
        teamId: 'T0FAKE',
        url: 'https://airia-fake.slack.com/',
        user: 'mw-bot',
        userId: 'U0BOT',
        botId: 'B0BOT',
        scopes: ['chat:write', 'channels:read'],
      },
    });
    expect(provider.calls).toEqual([
      {
        url: SLACK_AUTH_TEST,
        method: 'POST',
        headers: { authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'user-agent': TOOL_USER_AGENT },
        body: undefined,
        redirect: 'error',
        hasDeadline: true,
      },
    ]);
  });

  it('keeps a user token’s person, with no bot, and no scopes when Slack sends none', async () => {
    const provider = new FakeProvider().always(SLACK_AUTH_TEST, slackAuth('user', null));
    const user = await checkSlack(provider.fetch, 'slack_user_token', { token: SLACK_USER_TOKEN });
    expect(user).toMatchObject({ ok: true, accountMeta: { user: 'ihor', scopes: [] } });
    expect(user.ok && user.accountMeta).not.toHaveProperty('botId');
  });

  it.each([
    ['invalid_auth', slackRefusal('invalid_auth'), 'needs_sign_in'],
    ['token_revoked', slackRefusal('token_revoked'), 'needs_sign_in'],
    ['ratelimited', slackRefusal('ratelimited'), 'rate_limited'],
    ['an internal error', slackRefusal('internal_error'), 'provider_unavailable'],
    ['a token type it does not allow', slackRefusal('not_allowed_token_type'), 'refused'],
    ['another error', slackRefusal('team_added_to_org'), 'invalid_response'],
    ['a 429', status(429), 'rate_limited'],
    ['a 503', status(503), 'provider_unavailable'],
    ['a body that is no object', json(200, [1]), 'invalid_response'],
    ['an answer naming no workspace', json(200, { ok: true, user: 'x' }), 'invalid_response'],
    ['a bot token naming no bot', slackAuth('user'), 'invalid_response'],
  ])('reads %s as %s', async (_what, answer, code) => {
    const provider = new FakeProvider().always(SLACK_AUTH_TEST, answer);
    expect(await checkSlack(provider.fetch, 'slack_bot_token', bot)).toEqual({ ok: false, code });
  });

  it('refuses a user token that names a bot, and says an unreachable Slack is unavailable', async () => {
    const provider = new FakeProvider().always(SLACK_AUTH_TEST, slackAuth('bot'));
    const user = { token: SLACK_USER_TOKEN };
    expect(await checkSlack(provider.fetch, 'slack_user_token', user)).toEqual({
      ok: false,
      code: 'invalid_response',
    });
    const down = new FakeProvider().always(SLACK_AUTH_TEST, () => {
      throw new TypeError('fetch failed');
    });
    expect(await checkSlack(down.fetch, 'slack_bot_token', bot)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
  });
});
