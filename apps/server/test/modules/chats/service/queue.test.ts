import { chatTurns, tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { captureLogger } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatQueue } from '../../../../src/modules/chats/service/drain.ts';
import { chatsLive } from '../../../../src/modules/chats/service/live.ts';
import { type QueueDeps, sendMessage } from '../../../../src/modules/chats/service/queue.ts';
import { credentialsForHarness } from '../../../../src/modules/credentials/index.ts';
import { standingReader } from '../../../../src/modules/org/index.ts';
import { type ChatsWorld, chatsWorld, scene, turnRow } from '../../../fixtures/chats/world.ts';

// What the routes cannot reach: a turn the database says runs but this process does not know (left by a stopped
// server before its reaper ran) takes no message and no stop; the message waits for it all the same.

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
});
afterAll(() => w.close());

function deps(): QueueDeps {
  const { logger } = captureLogger();
  const base = { db: w.t.db, keyring: w.keyring, clock: w.clock, logger, providerFetch: w.provider.fetch };
  const credentials = credentialsForHarness(base);
  const turns = {
    hub: w.hub,
    credentials,
    live: chatsLive({ logger, clock: w.clock, credentials }),
    clock: w.clock,
    standing: standingReader(base),
  };
  return { ...turns, queue: chatQueue({ ...turns, logger }) };
}

describe('sendMessage', () => {
  it('queues Now and Interrupt behind a running turn this process does not know, and they wait', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const createdBy = s.company.owner.principalId;
    await t.insert(chatTurns, {
      id: newId(),
      chatId: s.chat.id,
      seq: 1,
      prompt: 'left',
      status: 'running',
      createdBy,
    });
    const d = deps();
    const caller = { principalId: createdBy };
    const now = await sendMessage(d, t, caller, s.chat.id, 'Use staging', 'now');
    const interrupt = await sendMessage(d, t, caller, s.chat.id, 'Stop', 'interrupt');
    expect([now, interrupt]).toMatchObject([
      { ok: true, turn: { status: 'queued', delivery: 'now', seq: 2 } },
      { ok: true, turn: { status: 'queued', delivery: 'interrupt', seq: 3 } },
    ]);
    if (!now.ok) throw new Error('not queued');
    expect((await turnRow(w.t.db, now.turn.id))?.status).toBe('queued');
  });
});
