import { agents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { endTurn } from '../../../../../fixtures/chats/world.ts';
import { SLACK_BOT_SCOPES, setScopes } from '../../../../../fixtures/integrations/slack.ts';
import {
  answerSlack,
  BOT,
  callsOf,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  putInbound,
  slackError,
} from '../../../../../fixtures/integrations/slack-inbound.ts';

/**
 * What receiving a Slack message reads and says (2026-11-13): people's names from Slack with `users:read`, else as
 * listed, else their ids, the bot by its own name; and a notice Slack refuses, logged.
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

/** The header line and the text of the next turn's prompt, its turn ended. */
async function promptOf(runner: FakeRunner) {
  const start = await runner.frames.next('turn.start');
  endTurn(runner, start.turnId);
  return start.spec.prompt;
}

describe('names', () => {
  it('come from the people listed, the bot’s own name and the ids when the bot may not read people', async () => {
    const s = await inboundScene(w, { settings: { wake: 'anyone' } });
    await setScopes(
      w.t.db,
      s.signIn.id,
      SLACK_BOT_SCOPES.filter((scope) => scope !== 'users:read'),
    );
    expect((await putInbound(w, s, { appToken: 'xapp-1-A0FAKE-1234567890-NOusersREAD' })).status).toBe(200);
    const conn = w.sockets.latest();
    await conn.deliver(message({ text: `<@${BOT}> ask <@U0ANNA> and <@U0IHOR>` }));
    expect(await promptOf(s.runner as FakeRunner)).toMatch(
      /^Slack message from Ihor Herasko in #general .*\n\n@mw-bot ask @U0ANNA and @Ihor Herasko$/s,
    );
    await conn.deliver(message({ user: 'U0STRANGER', text: `<@${BOT}> hi` }));
    expect(
      (await promptOf(s.runner as FakeRunner)).startsWith('Slack message from U0STRANGER in #general'),
    ).toBe(true);
    expect(callsOf(w, 'users.info')).toEqual([]);
  });
});

describe('a notice Slack refuses', () => {
  it('is logged, and the message is left', async () => {
    const s = await inboundScene(w);
    await rawDb(w.t.db).update(agents).set({ status: 'paused' }).where(eq(agents.id, s.agentId));
    answerSlack(w, { 'chat.postMessage': slackError('channel_not_found') });
    await s.conn.deliver(message());
    expect(w.logs.some((line) => line.msg === 'slack inbound: could not post a notice')).toBe(true);
  });
});
