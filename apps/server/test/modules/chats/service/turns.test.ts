import { chatTurns, tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { captureLogger } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { QUESTION_CLOSED } from '../../../../src/modules/chats/rules/questions.ts';
import { chatsLive } from '../../../../src/modules/chats/service/live.ts';
import { startTurn, stopTurn, type TurnsDeps } from '../../../../src/modules/chats/service/turns.ts';
import { credentialsForHarness } from '../../../../src/modules/credentials/index.ts';
import type { RunnerHub, TurnChannel, TurnSink } from '../../../../src/modules/machines/index.ts';
import { standingReader } from '../../../../src/modules/org/index.ts';
import { type ChatsWorld, chatsWorld, type Scene, scene, turnRow } from '../../../fixtures/chats/world.ts';

// What the routes cannot reach: a runner gone between the checks and the send, two prompts at the same moment, and a
// turn the database says runs but this process does not know (left by a stopped server before its reaper ran).

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
});
afterAll(() => w.close());

/** The service's deps on the world's hub with `turn` replaced. */
function depsWith(turn: RunnerHub['turn']): TurnsDeps {
  const { logger } = captureLogger();
  const deps = { db: w.t.db, keyring: w.keyring, clock: w.clock, logger, providerFetch: w.provider.fetch };
  const credentials = credentialsForHarness(deps);
  return {
    hub: { ...w.hub, turn },
    credentials,
    live: chatsLive({ logger, clock: w.clock, credentials }),
    clock: w.clock,
    standing: standingReader(deps),
  };
}

const caller = (s: Scene) => ({ principalId: s.company.owner.principalId });

describe('startTurn', () => {
  it('fails the turn at once when the runner went away before it could be sent', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const result = await startTurn(
      depsWith(() => undefined),
      t,
      caller(s),
      s.chat.id,
      'hi',
    );
    expect(result).toMatchObject({ ok: true, turn: { status: 'failed', error: 'machine_offline' } });
  });

  it('takes one of two prompts sent at the same moment, and refuses the other as turn_running', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const channel = (turnId: string): TurnChannel => ({ turnId, input: () => {}, stop: () => {} });
    const deps = depsWith((_machineId, request) => channel(request.turnId));
    const results = await Promise.all([
      startTurn(deps, t, caller(s), s.chat.id, 'one'),
      startTurn(deps, t, caller(s), s.chat.id, 'two'),
    ]);
    expect(results.map((result) => (result.ok ? 'started' : result.code)).sort()).toEqual([
      'started',
      'turn_running',
    ]);
  });
});

describe('a turn the runner refused as busy', () => {
  it('fails as before where nothing waits for slots (a live part without the slots)', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    let sink: TurnSink | undefined;
    const deps = depsWith((_machineId, request, given) => {
      sink = given;
      return { turnId: request.turnId, input: () => {}, stop: () => {} };
    });
    const result = await startTurn(deps, t, caller(s), s.chat.id, 'hi');
    await sink?.end({ ok: false, exitCode: null, error: 'busy' });
    const turnId = result.ok ? result.turn.id : '';
    expect(await turnRow(w.t.db, turnId)).toMatchObject({ status: 'failed', error: 'busy' });
  });
});

describe("startTurn's checks in the transaction that records it", () => {
  it('record nothing when the check refuses (an answer whose question a newer turn closed meanwhile)', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const seqs: number[] = [];
    const result = await startTurn(
      depsWith(() => undefined),
      t,
      caller(s),
      s.chat.id,
      'My answers',
      {
        kind: 'message',
        check: (seq) => {
          seqs.push(seq);
          return QUESTION_CLOSED;
        },
      },
    );
    expect(result).toMatchObject({ ok: false, code: 'question_closed' });
    expect(seqs).toEqual([1]);
    expect(await t.select(chatTurns)).toEqual([]);
  });
});

describe('stopTurn', () => {
  it('refuses a turn the database says runs but this process does not know', async () => {
    const s = await scene(w);
    const t = await tenant(w.t.db, s.company.companyId);
    const turnId = newId();
    await t.insert(chatTurns, {
      id: turnId,
      chatId: s.chat.id,
      seq: 1,
      prompt: 'left running',
      status: 'running',
      createdBy: s.company.owner.principalId,
    });
    const result = await stopTurn(
      depsWith(() => undefined),
      t,
      s.chat.id,
      turnId,
    );
    expect(result).toMatchObject({ ok: false, code: 'turn_not_running' });
  });
});
