import { describe, expect, it } from 'vitest';
import {
  checkAtlassian,
  confluenceCurrentUrl,
  jiraMyselfUrl,
} from '../../../../../src/modules/credentials/service/tools/atlassian.ts';
import { TOOL_USER_AGENT } from '../../../../../src/modules/credentials/service/tools/github.ts';
import { type Answer, FakeProvider, json } from '../../../../fixtures/credentials/providers.ts';
import {
  ATLASSIAN_TOKEN,
  CONFLUENCE_CURRENT,
  confluenceCurrent,
  EMAIL,
  JIRA_MYSELF,
  jiraMyself,
  SITE,
  status,
} from '../../../../fixtures/credentials/tools.ts';

const SECRET = { site: SITE, email: EMAIL, token: ATLASSIAN_TOKEN };
const BASIC = `Basic ${Buffer.from(`${EMAIL}:${ATLASSIAN_TOKEN}`).toString('base64')}`;

const answering = (jira: Answer, confluence: Answer) =>
  new FakeProvider().always(JIRA_MYSELF, jira).always(CONFLUENCE_CURRENT, confluence);

const down: Answer = () => {
  throw new TypeError('fetch failed');
};

describe('checkAtlassian', () => {
  it('asks Jira and Confluence on the site with basic auth, and keeps the products and the account', async () => {
    expect(jiraMyselfUrl(SITE)).toBe(JIRA_MYSELF);
    expect(confluenceCurrentUrl(SITE)).toBe(CONFLUENCE_CURRENT);
    const provider = answering(jiraMyself, confluenceCurrent);
    expect(await checkAtlassian(provider.fetch, SECRET)).toEqual({
      ok: true,
      accountEmail: EMAIL,
      accountMeta: {
        site: SITE,
        jira: true,
        confluence: true,
        accountId: '557058:fake-jira',
        displayName: 'Ihor Herasko',
      },
    });
    expect(provider.calls.map((call) => call.url).sort()).toEqual([CONFLUENCE_CURRENT, JIRA_MYSELF].sort());
    for (const call of provider.calls) {
      expect(call.headers).toEqual({
        accept: 'application/json',
        authorization: BASIC,
        'user-agent': TOOL_USER_AGENT,
      });
      expect(call).toMatchObject({ method: 'GET', redirect: 'error', hasDeadline: true });
    }
  });

  it('counts only the products that answer: Jira alone, Confluence alone', async () => {
    expect(await checkAtlassian(answering(jiraMyself, status(404)).fetch, SECRET)).toMatchObject({
      ok: true,
      accountMeta: { jira: true, confluence: false },
    });
    expect(await checkAtlassian(answering(status(403), confluenceCurrent).fetch, SECRET)).toMatchObject({
      ok: true,
      accountMeta: { jira: false, confluence: true, displayName: 'Ihor Herasko' },
    });
    expect(await checkAtlassian(answering(jiraMyself, down).fetch, SECRET)).toMatchObject({
      ok: true,
      accountMeta: { jira: true, confluence: false },
    });
  });

  it.each([
    ['two 401s', status(401), status(401), 'needs_sign_in'],
    ['a 401 and Confluence’s anonymous user', status(401), json(200, { type: 'anonymous' }), 'needs_sign_in'],
    ['a 401 and a 404', status(404), status(401), 'needs_sign_in'],
    ['a rate limit', status(429), status(404), 'rate_limited'],
    ['an outage', status(503), down, 'provider_unavailable'],
    ['two absent products', status(404), status(403), 'no_products'],
    ['an odd answer', json(200, ['not', 'an', 'object']), status(404), 'invalid_response'],
    ['a redirect', status(302), status(404), 'invalid_response'],
  ])('fails on %s', async (_, jira, confluence, code) => {
    expect(await checkAtlassian(answering(jira, confluence).fetch, SECRET)).toEqual({ ok: false, code });
  });
});
