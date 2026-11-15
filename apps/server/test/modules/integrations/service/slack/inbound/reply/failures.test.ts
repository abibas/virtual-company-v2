import { agents, credentials, slackThreads, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { turnsRepo } from '../../../../../../../src/modules/chats/repo/turns.ts';
import type { ChatDetailView } from '../../../../../../../src/modules/chats/schemas.ts';
import { chatPath, ended, eventually, turnRow } from '../../../../../../fixtures/chats/world.ts';
import { type Answer, json } from '../../../../../../fixtures/credentials/providers.ts';
import { rowOf } from '../../../../../../fixtures/credentials/tools.ts';
import {
  answerSlack,
  answerTurn,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  postsOf,
  slackError,
} from '../../../../../../fixtures/integrations/slack-inbound.ts';
import { as } from '../../../../../../fixtures/members/members.ts';
import { addSignIn, revokeSubscription } from '../../../../../../fixtures/org.ts';
import { noticesOf } from '../../../../../../fixtures/wakes.ts';

/**
 * An answer that could not be posted in Slack (T-22, docs/subscriptions.md "The turn and its answer"): the turn keeps
 * why (`chat_turns.reply_failure`), which the chat shows under the reply ("Not posted in Slack: <reason>"), naming the
 * bot sign-in at fault (gone, revoked, not a bot token, a refused token, a missing scope) or what Slack did (the bot not
 * in the channel, a rate limit, an outage, another refusal). A refused token marks the sign-in `needs_sign_in` and
 * tells its owner once per change; a reply posted later keeps its link and drops the failure.
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

const runnerOf = (s: InboundScene) => s.runner as FakeRunner;

/** A message's turn (a fresh mention by default) as the runner got it, after `meanwhile` ran; then its answer. */
async function answered(
  s: InboundScene,
  meanwhile: (start: TurnStart) => Promise<void> = async () => {},
  sent = message(),
): Promise<TurnStart> {
  await s.conn.deliver(sent);
  const start = await runnerOf(s).frames.next('turn.start');
  await meanwhile(start);
  answerTurn(runnerOf(s), start, 'Here.');
  await ended(w.t.db, start.turnId);
  return start;
}

const chatIdOf = async (turnId: string) => (await turnRow(w.t.db, turnId))?.chatId as string;

/** The turn as `GET …/chats/{chatId}` shows it, once its failure is kept. */
async function shownFailure(s: InboundScene, turnId: string) {
  await eventually('the failure is kept', async () => (await turnRow(w.t.db, turnId))?.replyFailure != null);
  const res = await as(w, s.company.owner)('GET', chatPath(s.company, await chatIdOf(turnId)));
  const turn = (res.body as ChatDetailView).turns.find((one) => one.id === turnId);
  expect(turn?.replyLink).toBeNull();
  return turn?.replyFailure;
}

/** Slack answers the answer's post this way; the failure the turn shows. */
async function refusedWith(s: InboundScene, answer: Answer, sent = message()) {
  answerSlack(w, { 'chat.postMessage': answer });
  const start = await answered(s, undefined, sent);
  return { start, failure: await shownFailure(s, start.turnId) };
}

describe('the bot sign-in at fault', () => {
  it('is gone: nothing is posted, the turn says so', async () => {
    const s = await inboundScene(w);
    const start = await answered(s, async () => {
      await rawDb(w.t.db).delete(credentials).where(eq(credentials.id, s.signIn.id));
    });
    expect(await shownFailure(s, start.turnId)).toEqual({
      reason: 'its Slack sign-in is gone',
      signIn: true,
    });
    expect(postsOf(w)).toEqual([]);
  });

  it('was revoked: named by its label, and logged', async () => {
    const s = await inboundScene(w);
    const start = await answered(s, () => revokeSubscription(w.t.db, s.signIn.id));
    expect(await shownFailure(s, start.turnId)).toEqual({
      reason: `the Slack sign-in '${s.signIn.label}' was revoked`,
      signIn: true,
    });
    expect(w.logs.some((line) => String(line.msg).startsWith('slack inbound: no answer posted:'))).toBe(true);
    expect(postsOf(w)).toEqual([]);
  });

  it('is not a bot token', async () => {
    const s = await inboundScene(w);
    const user = await addSignIn(w, w.keyring, s.company.owner.userId, 'slack_user_token');
    const start = await answered(s, async (turn) => {
      const chatId = await chatIdOf(turn.turnId);
      await rawDb(w.t.db)
        .update(slackThreads)
        .set({ credentialId: user.id })
        .where(eq(slackThreads.chatId, chatId));
    });
    expect(await shownFailure(s, start.turnId)).toEqual({
      reason: `the Slack sign-in '${user.label}' is not a bot token (xoxb-)`,
      signIn: true,
    });
    expect(postsOf(w)).toEqual([]);
  });
});

describe('Slack refusing the post', () => {
  it('with a refused token marks the sign-in needs_sign_in and tells its owner once', async () => {
    const s = await inboundScene(w);
    const first = message();
    const { failure } = await refusedWith(s, slackError('invalid_auth'), first);
    expect(failure).toEqual({
      reason: `the Slack sign-in '${s.signIn.label}' needs a new token`,
      signIn: true,
    });
    expect((await rowOf(w.t.db, s.signIn.id))?.status).toBe('needs_sign_in');
    const notices = () => noticesOf(w.t.db, s.company.owner.principalId, 'sign_in_needed');
    expect((await notices()).map((row) => [row.actorPrincipalId, row.payload])).toEqual([
      [
        null,
        expect.objectContaining({
          signIn: s.signIn.id,
          signInKind: 'slack_bot_token',
          detail: s.signIn.label,
        }),
      ],
    ]);
    const reply = message({ type: 'message', text: 'still there?', threadTs: first.ts });
    const next = await answered(s, undefined, reply);
    expect((await shownFailure(s, next.turnId))?.reason).toMatch(/needs a new token$/);
    expect(await notices()).toHaveLength(1);
    expect(
      w.logs.some(
        (line) => line.msg === 'slack inbound: the answer was not posted' && line.code === 'needs_sign_in',
      ),
    ).toBe(true);
  });

  it('with a missing scope blames the sign-in, which stays active', async () => {
    const s = await inboundScene(w);
    const { failure } = await refusedWith(s, slackError('missing_scope', { needed: 'chat:write' }));
    expect(failure).toEqual({
      reason: `the Slack sign-in '${s.signIn.label}' lacks a scope to post (chat:write)`,
      signIn: true,
    });
    expect((await rowOf(w.t.db, s.signIn.id))?.status).toBe('active');
    expect(await noticesOf(w.t.db, s.company.owner.principalId, 'sign_in_needed')).toEqual([]);
  });

  it('says what Slack did otherwise, no sign-in at fault', async () => {
    const cases = [
      [slackError('not_in_channel'), 'the bot is not in this channel: invite it there in Slack (/invite)'],
      [slackError('ratelimited'), 'Slack was limiting requests'],
      [slackError('internal_error'), 'Slack did not answer'],
      [json(503, {}), 'Slack did not answer'],
      [slackError('channel_not_found'), 'Slack refused it (channel_not_found)'],
    ] as const;
    for (const [answer, reason] of cases) {
      const s = await inboundScene(w);
      const { failure } = await refusedWith(s, answer);
      expect(failure).toEqual({ reason, signIn: false });
      expect((await rowOf(w.t.db, s.signIn.id))?.status).toBe('active');
    }
  });
});

describe('an answer neither posted nor kept as failed', () => {
  it('when its agent was archived meanwhile', async () => {
    const s = await inboundScene(w);
    const start = await answered(s, async () => {
      await rawDb(w.t.db).update(agents).set({ status: 'archived' }).where(eq(agents.id, s.agentId));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postsOf(w)).toEqual([]);
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({ replyLink: null, replyFailure: null });
  });

  it('when something unexpected failed: logged as an error', async () => {
    const s = await inboundScene(w);
    const start = await answered(s, async () => {
      await rawDb(w.t.db).update(credentials).set({ keyVersion: 99 }).where(eq(credentials.id, s.signIn.id));
    });
    await eventually('the error is logged', () =>
      w.logs.some(
        (line) => line.msg === 'slack inbound: the answer was not posted' && line.turnId === start.turnId,
      ),
    );
    expect(postsOf(w)).toEqual([]);
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({ replyLink: null, replyFailure: null });
  });
});

describe('a reply posted after a failure', () => {
  it('keeps its link and drops the failure; an unknown turn keeps nothing', async () => {
    const s = await inboundScene(w);
    const { start } = await refusedWith(s, slackError('not_in_channel'));
    const t = await tenant(w.t.db, s.company.companyId);
    const link = 'https://airia-fake.slack.com/archives/C0GENERAL1/p1731499999000100';
    expect(await turnsRepo.setReplyLink(t, start.turnId, link)).toMatchObject({
      replyLink: link,
      replyFailure: null,
    });
    const res = await as(w, s.company.owner)('GET', chatPath(s.company, await chatIdOf(start.turnId)));
    expect((res.body as ChatDetailView).turns.find((one) => one.id === start.turnId)).toMatchObject({
      replyLink: link,
      replyFailure: null,
    });
    const failure = { reason: 'Slack did not answer', signIn: false };
    expect(await turnsRepo.setReplyLink(t, newId(), link)).toBeUndefined();
    expect(await turnsRepo.setReplyFailure(t, newId(), failure)).toBeUndefined();
  });
});
