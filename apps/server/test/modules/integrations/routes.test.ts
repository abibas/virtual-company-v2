import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatsWorld, usesOf } from '../../fixtures/chats/world.ts';
import { call } from '../../fixtures/companies/companies.ts';
import { rawUser, slackScene } from '../../fixtures/integrations/slack.ts';
import {
  APP_TOKEN,
  answerSlack,
  callsOf,
  formOf,
  type InboundWorld,
  inboundPath,
  inboundScene,
  inboundWorld,
  ok,
  otherAgent,
  putInbound,
  slackError,
} from '../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../fixtures/members/members.ts';
import { addSignIn, revokeSubscription } from '../../fixtures/org.ts';
import { seedApiKey } from '../../fixtures/platform/auth.ts';

/**
 * A Slack bot sign-in's inbound settings and its people search (2026-11-13): the defaults before they are saved (only
 * listed people, the owner's own Slack person from their user token first), the default agent's choices, the checks of a
 * change (receiving needs the app token, the default agent one of the choices, a bot sign-in of the caller's), its audit
 * without the token, and a search by name or email with Slack's refusals in words; personal and session-only.
 */

let w: InboundWorld;

beforeAll(async () => {
  w = await inboundWorld();
});
afterEach(() => {
  w.provider.reset();
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

describe('the settings', () => {
  it('before they are saved: listed people only, the owner’s Slack person first, the agents it may route to', async () => {
    const s = await slackScene(w);
    await addSignIn(w, w.keyring, s.company.owner.userId, 'slack_user_token');
    const developer = await otherAgent(w, s, 'Developer', true);
    await otherAgent(w, s, 'Designer', false);
    const res = await as(w, s.company.owner)('GET', inboundPath(s.signIn.id));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      credentialId: s.signIn.id,
      appToken: false,
      inbound: false,
      wake: 'listed',
      people: [{ id: 'U0IHOR', name: 'ihor', image: null }],
      defaultAgent: null,
      maxPerHour: 30,
      lastHour: 0,
      status: 'off',
      receiving: true,
    });
    const agents = (res.body as { agents: { agentId: string; agentName: string }[] }).agents;
    expect(agents.map((agent) => agent.agentId).sort()).toEqual([s.agentId, developer.id].sort());
  });

  it('save with the people prefilled on the first change, and are audited without the token', async () => {
    const s = await slackScene(w);
    await addSignIn(w, w.keyring, s.company.owner.userId, 'slack_user_token');
    const saved = await putInbound(w, s, { appToken: APP_TOKEN, maxPerHour: 12 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ appToken: true, maxPerHour: 12, people: [{ id: 'U0IHOR' }] });
    const audit = await rawDb(w.t.db).select().from(auditLog).where(eq(auditLog.entityId, s.signIn.id));
    expect(audit.map((row) => [row.action, row.field, row.newValue])).toEqual(
      expect.arrayContaining([
        ['create', 'appToken', 'set'],
        ['create', 'maxPerHour', 12],
        ['create', 'people', ['U0IHOR']],
      ]),
    );
    const changed = await putInbound(w, s, { wake: 'anyone' });
    expect(changed.body).toMatchObject({ wake: 'anyone', people: [{ id: 'U0IHOR' }] });
  });

  it('refuse receiving without an app token, a default agent that is not a choice, and a bad token', async () => {
    const s = await slackScene(w);
    const designer = await otherAgent(w, s, 'Designer', false);
    expect(await putInbound(w, s, { inbound: true })).toMatchObject({
      status: 422,
      body: { error: { code: 'app_token_missing' } },
    });
    const notAChoice = { companyId: s.company.companyId, agentId: designer.id };
    expect(await putInbound(w, s, { defaultAgent: notAChoice })).toMatchObject({
      status: 422,
      body: { error: { code: 'agent_not_eligible' } },
    });
    expect((await putInbound(w, s, { appToken: 'xoxb-1-not-an-app-token' })).status).toBe(400);
    expect((await putInbound(w, s, { maxPerHour: 0 })).status).toBe(400);
    expect((await putInbound(w, s, { people: [{ id: 'C0GENERAL1', name: 'x', image: null }] })).status).toBe(
      400,
    );
  });

  it('are a bot sign-in’s of the caller’s: a user token is 422, another person’s or none 404, an API key 403', async () => {
    const s = await slackScene(w);
    const user = await addSignIn(w, w.keyring, s.company.owner.userId, 'slack_user_token');
    expect(await as(w, s.company.owner)('GET', inboundPath(user.id))).toMatchObject({
      status: 422,
      body: { error: { code: 'not_a_slack_bot' } },
    });
    const github = await addSignIn(w, w.keyring, s.company.owner.userId, 'github_token');
    expect((await as(w, s.company.owner)('GET', inboundPath(github.id))).status).toBe(404);
    const other = await slackScene(w);
    expect((await as(w, other.company.owner)('GET', inboundPath(s.signIn.id))).status).toBe(404);
    expect(
      (await as(w, other.company.owner)('PUT', inboundPath(s.signIn.id), { inbound: false })).status,
    ).toBe(404);
    const { key } = await seedApiKey(w.t.db, {
      companyId: s.company.companyId,
      principalId: s.company.owner.principalId,
    });
    expect(await call(w, key)('GET', inboundPath(s.signIn.id))).toMatchObject({
      status: 403,
      body: { error: { code: 'session_required' } },
    });
    await revokeSubscription(w.t.db, s.signIn.id);
    expect(await as(w, s.company.owner)('GET', inboundPath(s.signIn.id))).toMatchObject({
      status: 422,
      body: { error: { code: 'credential_revoked' } },
    });
  });

  it('say the last hour’s wakes', async () => {
    const s = await inboundScene(w, { settings: { maxPerHour: 5 } });
    const res = await as(w, s.company.owner)('GET', inboundPath(s.signIn.id));
    expect(res.body).toMatchObject({ lastHour: 0, maxPerHour: 5, inbound: true, appToken: true });
  });
});

describe('the people search', () => {
  const search = (s: Awaited<ReturnType<typeof slackScene>>, q: string) =>
    as(w, s.company.owner)('GET', `${inboundPath(s.signIn.id, 'slack-people')}?q=${encodeURIComponent(q)}`);

  it('finds people by name among the workspace’s, without bots or deactivated people', async () => {
    const s = await slackScene(w);
    answerSlack(w, {
      'users.list': [
        ok({
          members: [
            rawUser('U0IHOR', 'ihor', {
              real_name: 'Ihor Herasko',
              profile: { image_72: 'https://a.slack-edge.com/i.png' },
            }),
            rawUser('U0BOTX', 'ihorbot', { is_bot: true }),
          ],
          response_metadata: { next_cursor: 'next' },
        }),
        ok({ members: [rawUser('U0GONE', 'ihor-old', { deleted: true }), rawUser('U0ANNA', 'anna')] }),
      ],
    });
    const res = await search(s, 'IHOR');
    expect(res).toMatchObject({
      status: 200,
      body: { people: [{ id: 'U0IHOR', name: 'Ihor Herasko', image: 'https://a.slack-edge.com/i.png' }] },
    });
    expect(callsOf(w, 'users.list').map(formOf)).toEqual([
      { limit: '200' },
      { limit: '200', cursor: 'next' },
    ]);
    expect((await usesOf(w.t.db, s.signIn.id)).map((use) => use.purpose)).toContain('slack_people');
  });

  it('finds one person by email, none when Slack knows no such person', async () => {
    const s = await slackScene(w);
    answerSlack(w, {
      'users.lookupByEmail': [
        ok({ user: rawUser('U0IHOR', 'ihor', { profile: { image_72: 'http://x' } }) }),
        slackError('users_not_found'),
      ],
    });
    expect((await search(s, 'ihor@airia.com')).body).toEqual({
      people: [{ id: 'U0IHOR', name: 'ihor', image: null }],
    });
    expect((await search(s, 'nobody@airia.com')).body).toEqual({ people: [] });
  });

  it('says Slack’s refusals and outages in words', async () => {
    const s = await slackScene(w);
    answerSlack(w, {
      'users.list': [slackError('missing_scope', { needed: 'users:read' }), slackError('fatal_error')],
    });
    expect(await search(s, 'ihor')).toMatchObject({
      status: 422,
      body: { error: { code: 'slack_refused' } },
    });
    expect(await search(s, 'ihor')).toMatchObject({
      status: 502,
      body: { error: { code: 'provider_unavailable' } },
    });
    expect((await search(s, ' ')).status).toBe(400);
    await revokeSubscription(w.t.db, s.signIn.id);
    expect((await search(s, 'ihor')).status).toBe(422);
  });
});

describe('a server that keeps no connections', () => {
  it('stores the settings and says it does not receive', async () => {
    const plain = await chatsWorld();
    try {
      const s = await slackScene(plain);
      const saved = await as(plain, s.company.owner)('PUT', inboundPath(s.signIn.id), {
        appToken: APP_TOKEN,
        inbound: true,
      });
      expect(saved.body).toMatchObject({ receiving: false, inbound: true, status: 'off' });
    } finally {
      await plain.disconnectAll();
      await plain.close();
    }
  });
});
