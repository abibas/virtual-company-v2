import { createPgliteDb } from '@mwc/db/pglite';
import { captureLogger, LEVEL, TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { reapTurns, SERVER_RESTARTED, type TaskTurnHook } from '../../../../src/modules/chats/index.ts';
import { taskTurnHook } from '../../../../src/modules/tasks/index.ts';
import {
  type ChatsWorld,
  chatsWorld,
  ended,
  endTurn,
  scene,
  startedTurn,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { runScene, taskRow } from '../../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
});
afterAll(() => w.close());

describe('reapTurns', () => {
  it('fails every turn a stopped server left running, in every company, and says how many', async () => {
    const left = [await startedTurn(w, await scene(w)), await startedTurn(w, await scene(w))];
    const done = await scene(w);
    const finished = await startedTurn(w, done);
    endTurn(done.runner as FakeRunner, finished.turnId);
    await ended(w.t.db, finished.turnId);
    const { logger, lines } = captureLogger();
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger })).toBe(2);
    for (const turn of left) {
      expect(await turnRow(w.t.db, turn.turnId)).toMatchObject({
        status: 'failed',
        error: SERVER_RESTARTED,
        endedAt: new Date(TEST_NOW),
      });
    }
    expect((await turnRow(w.t.db, finished.turnId))?.status).toBe('done');
    expect(lines.find((line) => line.failed === 2)).toMatchObject({ level: LEVEL.info });
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger })).toBe(0);
    expect(lines.filter((line) => line.failed !== undefined)).toHaveLength(1);
  });

  it('is a warning, never a stop, when it cannot run (a database without the migrations)', async () => {
    const db = await createPgliteDb();
    const { logger, lines } = captureLogger();
    expect(await reapTurns({ db, clock: w.clock, logger })).toBe(0);
    expect(lines.find((line) => line.level === LEVEL.warn)?.msg).toContain('could not fail the chat turns');
    await db.close();
  });
});

describe('reapTurns and a task’s conversation (S5.3b)', () => {
  it('blocks the task whose step’s turn a stopped server left running', async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    await s.runner.frames.next('turn.start');
    const { logger } = captureLogger();
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger, tasks: taskTurnHook({ logger }) })).toBe(1);
    const row = await taskRow(w.t.db, task.id);
    expect(row).toMatchObject({ stepState: 'blocked', blockedReason: SERVER_RESTARTED });
  });

  it('logs a task it cannot tell, and goes on', async () => {
    const s = await runScene(w);
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    await s.runner.frames.next('turn.start');
    const { logger, lines } = captureLogger();
    const broken = {
      prepare: () => Promise.reject(new Error('no tasks here')),
    } as unknown as TaskTurnHook;
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger, tasks: broken })).toBe(1);
    expect(
      lines.find((line) => line.msg === 'could not tell the task of a turn a stopped server left'),
    ).toBeDefined();
  });
});
