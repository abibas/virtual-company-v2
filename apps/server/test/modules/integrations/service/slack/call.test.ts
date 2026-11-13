import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { SlackRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SLACK_SIGN_IN_REVOKED } from '../../../../../src/modules/credentials/service/tool-use.ts';
import { callSlack, NO_PROFILE } from '../../../../../src/modules/integrations/service/slack/call.ts';
import { type ChatsWorld, chatsWorld, turnRow, usesOf } from '../../../../fixtures/chats/world.ts';
import { status } from '../../../../fixtures/credentials/tools.ts';
import {
  answerSlack,
  BOT_TOKEN,
  CHAT_GENERAL,
  callsOf,
  callTool,
  ok,
  putSlackPart,
  rawChannel,
  SLACK_BOT_SCOPES,
  type SlackScene,
  setScopes,
  slackError,
  slackScene,
  slackTurn,
  statusOf,
} from '../../../../fixtures/integrations/slack.ts';
import { revokeSubscription } from '../../../../fixtures/org.ts';

/**
 * A Slack tool's call (S7.1e), checked again on the server: the profile read now, its rights as its token's scopes let
 * them work, refused arguments and input, the sign-in opened for `tool:<name>`, and Slack's refusals in words (an invalid
 * token marking the sign-in). One turn serves every test; the part is changed between calls.
 */

let w: ChatsWorld;
let s: SlackScene;
let start: TurnStart;

const part = (rights: Partial<SlackRights> | null, credentialId: string | null = s.signIn.id) =>
  putSlackPart(w.t.db, s.profile.id, {
    credentialId,
    rights: rights === null ? null : { ...CHAT_GENERAL, ...rights },
  });

beforeAll(async () => {
  w = await chatsWorld();
});
let made: Promise<void> | undefined;
beforeEach(async () => {
  made ??= (async () => {
    s = await slackScene(w);
    start = await slackTurn(w, s);
  })();
  await made;
}, 20_000);
afterEach(async () => {
  w.provider.reset();
  await part({});
  await setScopes(w.t.db, s.signIn.id, SLACK_BOT_SCOPES);
  await rawDb(w.t.db).update(credentials).set({ status: 'active' }).where(eq(credentials.id, s.signIn.id));
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

const history = () => callTool(s, start, 'slack_get_channel_history', { channel_id: 'C0GENERAL1' });
const GENERAL = { 'conversations.info': ok({ channel: rawChannel('C0GENERAL1', 'general') }) };

describe('a Slack call’s checks', () => {
  it('opens the sign-in for tool:<name>, as the agent in its chat for who sent the prompt, with the bearer', async () => {
    answerSlack(w, { ...GENERAL, 'conversations.history': ok({ messages: [] }) });
    expect(await history()).toMatchObject({ ok: true });
    expect(callsOf(w, 'conversations.history')[0]?.headers.authorization).toBe(`Bearer ${BOT_TOKEN}`);
    const turn = await turnRow(w.t.db, start.turnId);
    const uses = (await usesOf(w.t.db, s.signIn.id)).filter((use) => use.purpose.startsWith('tool:'));
    expect(uses).toMatchObject([
      {
        purpose: 'tool:slack_get_channel_history',
        companyId: s.company.companyId,
        agentId: s.agentId,
        chatId: s.chat.id,
        principalId: turn?.createdBy,
      },
    ]);
  });

  it('reads the part again: a right turned off since the turn began is refused before Slack hears of it', async () => {
    await part({ post: false });
    const result = await callTool(s, start, 'slack_post_message', { channel_id: '#general', text: 'Hi' });
    expect(result).toMatchObject({
      ok: false,
      text: "Posting in Slack is off for this agent's profile: it may only read.",
    });
    await part({ react: false });
    expect((await callTool(s, start, 'slack_add_reaction', {})).text).toBe(
      "Reactions are off for this agent's profile.",
    );
    expect((await callTool(s, start, 'slack_search_messages', { query: 'x' })).text).toBe(
      "Searching Slack is off for this agent's profile.",
    );
    expect(w.provider.calls).toEqual([]);
  });

  it('refuses a right whose scopes the token lacks, naming them', async () => {
    await setScopes(w.t.db, s.signIn.id, ['channels:read', 'channels:history']);
    expect(
      (await callTool(s, start, 'slack_post_message', { channel_id: '#general', text: 'Hi' })).text,
    ).toBe(
      "The Slack sign-in of this agent's profile needs chat:write for slack_post_message: its owner adds it to the " +
        'Slack app, reinstalls the app and adds the new token.',
    );
    expect((await callTool(s, start, 'slack_get_users', {})).text).toContain(
      'needs users:read for slack_get_users',
    );
    await part({ search: true });
    expect((await callTool(s, start, 'slack_search_messages', { query: 'x' })).text).toContain(
      'needs a user token (xoxp-) with search:read for slack_search_messages',
    );
    await part({ read: false, dms: 'read' });
    expect((await history()).text).toContain('needs im:read, im:history for slack_get_channel_history');
  });

  it('refuses without a part or a sign-in, an argument not offered, and an input that is not the tool’s', async () => {
    await part(null, null);
    expect((await history()).text).toBe("This agent's profile has no Slack part now.");
    await part({}, null);
    expect((await history()).text).toContain('Slack part has no sign-in now');
    await part({});
    const named = await callTool(s, start, 'slack_post_message', {
      channel_id: '#general',
      text: 'x',
      username: 'CEO',
    });
    expect(named.text).toContain('Most Wanted posts under the agent’s own name and icon');
    const broadcast = { channel_id: 'C0GENERAL1', thread_ts: '1.2', text: 'x', reply_broadcast: true };
    expect((await callTool(s, start, 'slack_reply_to_thread', broadcast)).text).toContain(
      'stays in its thread',
    );
    const bad = await callTool(s, start, 'slack_get_thread_replies', {
      channel_id: 'C0GENERAL1',
      thread_ts: 'yesterday',
    });
    expect(bad.text).toMatch(/^slack_get_thread_replies did nothing; fix its input and call it again:\n/);
    expect(w.provider.calls).toEqual([]);
  });

  it('marks a token Slack no longer takes as needing a new one, and refuses a revoked sign-in', async () => {
    answerSlack(w, { ...GENERAL, 'conversations.history': slackError('invalid_auth') });
    const refused = await history();
    expect(refused.text).toContain('Slack refused the token (invalid or revoked)');
    expect(refused.text).not.toContain(BOT_TOKEN);
    expect(await statusOf(w.t.db, s.signIn.id)).toBe('needs_sign_in');
    await revokeSubscription(w.t.db, s.signIn.id);
    expect((await history()).text).toBe(SLACK_SIGN_IN_REVOKED);
  });

  it('says a rate limit with when to try again, and a missing scope Slack names', async () => {
    answerSlack(w, { 'conversations.info': status(429, { 'retry-after': '30' }) });
    expect((await history()).text).toBe('Slack is limiting requests. Try again in 30 s.');
    answerSlack(w, { 'conversations.info': slackError('missing_scope', { needed: 'channels:read' }) });
    expect((await history()).text).toContain('lacks the scope channels:read');
  });
});

describe('callSlack on its own', () => {
  it('refuses a tool that is not Slack’s and a turn on no profile', async () => {
    const deps = {} as Parameters<typeof callSlack>[0];
    const turn = { turnId: 't', chatId: 'c', agentPrincipalId: 'a', profileId: null, by: 'p' };
    const t = {} as Parameters<typeof callSlack>[1];
    expect(await callSlack(deps, t, turn, { callId: 'x', tool: 'getJiraIssue', input: {} })).toEqual({
      ok: false,
      text: 'Unknown tool: getJiraIssue',
    });
    expect(await callSlack(deps, t, turn, { callId: 'x', tool: 'slack_get_users', input: {} })).toEqual({
      ok: false,
      text: NO_PROFILE,
    });
  });
});
