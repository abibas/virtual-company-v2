import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type OpenActivity, openActivity } from '../../../../fixtures/chats/activity.ts';
import { type OpenStream, openStream } from '../../../../fixtures/chats/stream.ts';
import { chatPath, eventually } from '../../../../fixtures/chats/world.ts';
import {
  answerTurn,
  BOT,
  type InboundWorld,
  inboundScene,
  inboundWorld,
  message,
  postsOf,
} from '../../../../fixtures/integrations/slack-inbound.ts';

/**
 * A Slack message's turn, live (2026-11-13, docs/harness.md "Live chat lists"): the new "Slack · …" chat shows in the
 * company's chats' activity at once with its turn running, as the sender's (`from`, via Slack), and a reply in the same
 * thread reaches the chat's own stream as a person's message does.
 */

let w: InboundWorld;
const open: (OpenActivity | OpenStream)[] = [];
beforeAll(async () => {
  w = await inboundWorld();
});
afterEach(async () => {
  for (const stream of open.splice(0)) await stream.close();
  w.provider.reset();
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

type TurnMessage = { readonly turn: { readonly status: string; readonly from: unknown; readonly system: boolean } };

describe('a Slack message’s turn', () => {
  it('shows its new chat at once, then streams into it like a person’s message', async () => {
    const s = await inboundScene(w);
    const owner = s.company.owner;
    const live = await openActivity(w.t.app, s.company.companyId, owner);
    open.push(live);
    const first = message({ text: `<@${BOT}> Bro are you there?` });
    await s.conn.deliver(first);
    const shown = await live.next('the Slack chat', (v) => v.lastTurn?.status === 'running');
    expect(shown.chat).toMatchObject({ agentId: s.agentId, title: 'Slack · #general · Bro are you there?' });
    expect(shown.lastTurn).toMatchObject({
      system: true,
      from: { name: 'Ihor Herasko', via: 'slack' },
    });
    const runner = s.runner as FakeRunner;
    answerTurn(runner, await runner.frames.next('turn.start'), 'Here.');
    await live.next('its reply', (v) => v.lastTurn?.status === 'done');
    await eventually('the answer is posted', () => postsOf(w).length === 1);

    const thread = await openStream(w.t.app, chatPath(s.company, shown.chat.id, '/stream'), {
      authorization: `Bearer fake:${owner.subject}`,
    });
    open.push(thread);
    await s.conn.deliver(message({ text: 'And now?', threadTs: first.ts }));
    await thread.until('the reply’s turn', (messages) =>
      messages.some((m) => m.event === 'turn' && (m.data as TurnMessage).turn.status === 'running'),
    );
    const turn = thread.messages.find((m) => m.event === 'turn')?.data as TurnMessage;
    expect(turn.turn).toMatchObject({ system: true, from: { name: 'Ihor Herasko', via: 'slack' } });
    expect(live.chats().filter((v) => v.chat.id !== shown.chat.id)).toEqual([]);
    answerTurn(runner, await runner.frames.next('turn.start'), 'Still here.');
    await eventually('the second answer is posted', () => postsOf(w).length === 2);
  });
});
