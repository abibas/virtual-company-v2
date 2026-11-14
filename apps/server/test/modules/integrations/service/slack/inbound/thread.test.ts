import type { FakeRunner } from '@mwc/testkit/runner';
import type { SlackInboundMessage } from '@mwc/tools-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eventually, turnRow } from '../../../../../fixtures/chats/world.ts';
import { rawUser } from '../../../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  answerTurn,
  BOT,
  callsOf,
  GENERAL,
  IHOR,
  type InboundScene,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  ok,
  postRows,
  postsGetTheirOwnTs,
  postsOf,
  slackError,
} from '../../../../../fixtures/integrations/slack-inbound.ts';

/**
 * A reply's thread context (2026-11-14, docs/subscriptions.md "Thread context"; Erich asked the bot to approve a pull
 * request in a thread's first message, the first turn failed on a stopped machine, and Ihor's reply reached the agent
 * without the link): a reply's prompt carries the thread's earlier messages the agent has not seen, the first message
 * always, with names and the unfurled pull request's address; only those after its last successful turn there, never
 * its own posts; one line when the bot lacks the scope or Slack refuses; nothing for a message in no thread.
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

const ERICH = 'U0ERICH';
const PR = 'https://github.com/AiriaLLC/airia-platform/pull/4242';

async function sceneOf() {
  const s = await inboundScene(w);
  postsGetTheirOwnTs(w);
  answerSlack(w, {
    'users.info': (call) => {
      const user = new URLSearchParams(String(call.body)).get('user');
      const name = user === ERICH ? 'Erich Example' : user === IHOR ? 'Ihor Herasko' : 'Somebody';
      return ok({ user: rawUser(user ?? '', name) })(call);
    },
  });
  return s;
}

/** Delivers a message and gives the prompt of the turn it starts; answers it unless `answer` is null. */
async function promptOf(s: InboundScene, sent: SlackInboundMessage, answer: string | null = 'Done.') {
  const runner = s.runner as FakeRunner;
  const before = postsOf(w).length;
  await s.conn.deliver(sent);
  const start = await runner.frames.next('turn.start');
  if (answer !== null) {
    answerTurn(runner, start, answer);
    await eventually('the answer is posted', () => postsOf(w).length > before);
  }
  return { prompt: start.spec.prompt, turnId: start.turnId };
}

const root = (ts: string) => ({
  ts,
  user: ERICH,
  text: `<@${BOT}> Approve: <${PR}>`,
  attachments: [{ from_url: PR, title: '#4242 Fix the login', service_name: 'GitHub' }],
});

describe('a reply in a thread', () => {
  it('carries the whole thread when the agent saw none of it: the first message with its PR, names and notices', async () => {
    const s = await sceneOf();
    const first = message({ text: `<@${BOT}> Approve` });
    const reply = message({ text: `<@${BOT}> <@${ERICH}> has asked you to approve!`, threadTs: first.ts });
    answerSlack(w, {
      'conversations.replies': ok({
        messages: [
          root(first.ts),
          {
            ts: `${first.ts.split('.')[0]}.900000`,
            bot_id: 'B0BOT',
            text: "Couldn't answer: Airia devbox is stopped.",
          },
          { ts: reply.ts, user: IHOR, text: reply.text },
        ],
      }),
    });
    const { prompt } = await promptOf(s, reply);
    const [header, , ...rest] = prompt.split('\n');
    expect(header).toContain('Slack message from Ihor Herasko in #general');
    expect(rest.join('\n')).toBe(
      [
        'Earlier in this thread:',
        `- Erich Example (first message): @mw-bot Approve: ${PR} [shared: #4242 Fix the login (${PR})]`,
        "- a bot: Couldn't answer: Airia devbox is stopped.",
        '',
        'Their message:',
        '',
        '@mw-bot @Erich Example has asked you to approve!',
      ].join('\n'),
    );
    const read = callsOf(w, 'conversations.replies').at(-1);
    expect(new URLSearchParams(String(read?.body)).get('ts')).toBe(first.ts);
  });

  it('carries only what came after its last successful turn there, never its own posts, the first message always', async () => {
    const s = await sceneOf();
    const first = message({ text: `<@${BOT}> Approve` });
    answerSlack(w, { 'conversations.replies': ok({ messages: [root(first.ts)] }) });
    const opened = await promptOf(s, first, 'Looking.');
    expect(opened.prompt).not.toContain('Earlier in this thread');
    const asked = (await turnRow(w.t.db, opened.turnId))?.createdAt as Date;
    const at = (seconds: number) => `${Math.floor(asked.getTime() / 1000) + seconds}.000100`;
    const own = (await postRows(w.t.db)).at(-1);
    const reply = message({ type: 'message', text: 'and now?', threadTs: first.ts, ts: at(30) });
    answerSlack(w, {
      'conversations.replies': ok({
        messages: [
          root(first.ts),
          { ts: at(-5), user: ERICH, text: 'seen before' },
          { ts: own?.ts, bot_id: 'B0BOT', username: s.agentName, text: 'Looking.' },
          { ts: at(10), user: ERICH, text: 'new one' },
          { ts: at(20), user: IHOR, text: 'and another' },
          { ts: reply.ts, user: IHOR, text: 'and now?' },
          { ts: at(40), user: ERICH, text: 'after the message' },
        ],
      }),
    });
    const { prompt } = await promptOf(s, reply);
    const block = prompt.slice(
      prompt.indexOf('Earlier in this thread:'),
      prompt.indexOf('\n\nTheir message:'),
    );
    expect(block.split('\n')).toEqual([
      'Earlier in this thread:',
      `- Erich Example (first message): @mw-bot Approve: ${PR} [shared: #4242 Fix the login (${PR})]`,
      '- Erich Example: new one',
      '- Ihor Herasko: and another',
    ]);
  });

  it('trims the thread to its budget, the oldest dropped first and the first message kept', async () => {
    const s = await sceneOf();
    const first = message({ text: `<@${BOT}> start` });
    const reply = message({ text: `<@${BOT}> so?`, threadTs: first.ts });
    const long = Array.from({ length: 12 }, (_, i) => ({
      ts: `${first.ts.split('.')[0]}.${String(200 + i).padStart(6, '0')}`,
      user: ERICH,
      text: `${i}:${'x'.repeat(1500)}`,
    }));
    answerSlack(w, { 'conversations.replies': ok({ messages: [root(first.ts), ...long] }) });
    const { prompt } = await promptOf(s, reply);
    const lines = prompt.split('\n').filter((line) => line.startsWith('- '));
    expect(lines[0]).toContain('(first message)');
    expect(lines[1]).toMatch(/^- \(\d+ earlier messages left out\)$/);
    expect(lines.at(-1)).toContain('11:xxx');
    expect(lines.slice(2).join('\n').length).toBeLessThan(8_000);
  });

  it('says in one line when Slack refuses the read or the bot lacks the history scope', async () => {
    const s = await sceneOf();
    const first = message();
    answerSlack(w, { 'conversations.replies': slackError('missing_scope', { needed: 'channels:history' }) });
    const refused = await promptOf(s, message({ text: `<@${BOT}> hm`, threadTs: first.ts }));
    expect(refused.prompt).toContain(
      'Earlier in this thread: not read: the Slack app has no channels:history scope (add it',
    );
    answerSlack(w, {
      'conversations.replies': slackError('thread_not_found'),
      'users.info': slackError('user_not_found'),
    });
    const unread = await promptOf(s, message({ text: `<@${BOT}> hm`, threadTs: first.ts }));
    expect(unread.prompt).toContain('Earlier in this thread: could not be read (');
    const group = { channel: 'G0GROUPDM', channelType: 'mpim', threadTs: first.ts };
    const noScope = await promptOf(s, message({ ...group, text: `<@${BOT}> hm` }));
    expect(noScope.prompt).toContain(
      'Earlier in this thread: not read: the Slack app has no mpim:history scope',
    );
    // Only the routing's look at the thread's first message (limit 1); no read for the context.
    const groupReads = callsOf(w, 'conversations.replies').filter(
      (call) => new URLSearchParams(String(call.body)).get('channel') === 'G0GROUPDM',
    );
    expect(groupReads.map((call) => new URLSearchParams(String(call.body)).get('limit'))).toEqual(['1']);
  });

  it('reads nothing for a message in no thread', async () => {
    const s = await sceneOf();
    const { prompt } = await promptOf(s, message({ channel: GENERAL }));
    expect(prompt).not.toContain('Earlier in this thread');
    expect(callsOf(w, 'conversations.replies')).toEqual([]);
  });
});
