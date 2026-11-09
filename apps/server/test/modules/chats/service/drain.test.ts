import { chatTurns, type TenantDb, tenant } from '@mwc/db';
import type { ChatTurnDelivery } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { captureLogger } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatQueue, type DrainDeps } from '../../../../src/modules/chats/service/drain.ts';
import { chatsLive } from '../../../../src/modules/chats/service/live.ts';
import { credentialsForHarness } from '../../../../src/modules/credentials/index.ts';
import type { RunnerHub } from '../../../../src/modules/machines/index.ts';
import { type ChatsWorld, chatsWorld, type Scene, scene, turnRow } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';

// What the routes cannot reach: a waiting turn that goes or loses its start to another one while its checks run, a
// runner gone between the checks and the send, settings that no longer make a spec, and a queue that fails.

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
});
afterAll(() => w.close());

/** The drain's deps on the world, with `turn` and the credential lookup replaceable. */
function depsWith(options: { turn?: RunnerHub['turn']; beforeCredential?: () => Promise<void> } = {}) {
  const capture = captureLogger();
  const deps = {
    db: w.t.db,
    keyring: w.keyring,
    clock: w.clock,
    logger: capture.logger,
    providerFetch: w.provider.fetch,
  };
  const real = credentialsForHarness(deps);
  const credentials = {
    ...real,
    credential: async (...args: Parameters<typeof real.credential>) => {
      await options.beforeCredential?.();
      return real.credential(...args);
    },
  };
  const drain: DrainDeps = {
    hub: options.turn ? { ...w.hub, turn: options.turn } : w.hub,
    credentials,
    live: chatsLive({ logger: capture.logger, clock: w.clock, credentials }),
    clock: w.clock,
    logger: capture.logger,
  };
  return { drain, capture };
}

/** A waiting turn of the scene's chat, with nothing running. */
async function waiting(t: TenantDb, s: Scene, seq = 1, delivery: ChatTurnDelivery = 'after') {
  const id = newId();
  await t.insert(chatTurns, {
    id,
    chatId: s.chat.id,
    seq,
    prompt: `waiting ${seq}`,
    delivery,
    createdBy: s.company.owner.principalId,
  });
  return id;
}

describe('the chats’ queue', () => {
  it('leaves the chat to a start that won the race while its checks ran', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const id = await waiting(t, s);
    const other = newId();
    const { drain } = depsWith({
      beforeCredential: async () => {
        await t.insert(chatTurns, {
          id: other,
          chatId: s.chat.id,
          seq: 2,
          prompt: 'won',
          status: 'running',
          createdBy: s.company.owner.principalId,
        });
      },
    });
    await chatQueue(drain).startNext(t, s.chat.id);
    expect((await turnRow(w.t.db, id))?.status).toBe('queued');
  });

  it('moves on when the waiting turn went while its checks ran', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const id = await waiting(t, s);
    const { drain } = depsWith({
      beforeCredential: () => t.delete(chatTurns, eq(chatTurns.id, id)).then(() => {}),
    });
    await chatQueue(drain).startNext(t, s.chat.id);
    expect(await turnRow(w.t.db, id)).toBeUndefined();
  });

  it('fails a turn whose runner went before the send, then starts the next', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const first = await waiting(t, s, 1);
    const second = await waiting(t, s, 2);
    let calls = 0;
    const { drain } = depsWith({ turn: (...args) => (++calls === 1 ? undefined : w.hub.turn(...args)) });
    await chatQueue(drain).startNext(t, s.chat.id);
    expect(await turnRow(w.t.db, first)).toMatchObject({ status: 'failed', error: 'machine_offline' });
    expect((await (s.runner as FakeRunner).frames.next('turn.start')).turnId).toBe(second);
  });

  it("fails a turn the agent's settings no longer make a spec for, naming the field", async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    await as(w, s.company.owner)('PATCH', `/api/companies/${s.company.companyId}/agents/${s.agentId}`, {
      model: 'claude opus',
    });
    const id = await waiting(t, s);
    const { drain } = depsWith();
    await chatQueue(drain).startNext(t, s.chat.id);
    expect(await turnRow(w.t.db, id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('model'),
    });
  });

  it('logs a queue that fails, and the next start still runs', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const { drain, capture } = depsWith();
    const queue = chatQueue(drain);
    const broken = { select: () => Promise.reject(new Error('db down')) } as unknown as TenantDb;
    await queue.startNext(broken, s.chat.id);
    expect(capture.lines.map((line) => line.msg)).toContain('chats: could not start the next waiting turn');
    const id = await waiting(t, s);
    await queue.startNext(t, s.chat.id);
    expect((await turnRow(w.t.db, id))?.status).toBe('running');
  });
});
