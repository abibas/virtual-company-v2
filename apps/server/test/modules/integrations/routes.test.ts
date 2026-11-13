import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatsWorld } from '../../fixtures/chats/world.ts';
import { call } from '../../fixtures/companies/companies.ts';
import { slackScene } from '../../fixtures/integrations/slack.ts';
import {
  APP_TOKEN,
  type InboundWorld,
  inboundPath,
  inboundScene,
  inboundWorld,
  otherAgent,
  putInbound,
} from '../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../fixtures/members/members.ts';
import { addSignIn, revokeSubscription } from '../../fixtures/org.ts';
import { seedApiKey } from '../../fixtures/platform/auth.ts';

/**
 * A Slack bot sign-in's inbound settings and its people search (2026-11-13): the defaults before they are saved (only
 * listed people, the owner's own Slack person from their user token first), the default agent's choices, the checks of a
 * change (receiving needs the app token, the default agent one of the choices, a bot sign-in of the caller's), its audit
 * without the token; personal and session-only. The people search is in `routes/slack-people.test.ts`.
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
