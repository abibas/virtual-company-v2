import { chatTurns } from '@mwc/db';
import { createPgliteDb } from '@mwc/db/pglite';
import { rawDb } from '@mwc/db/system';
import { captureLogger, LEVEL, TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { reapTurns, SERVER_RESTARTED, type TaskTurnHook } from '../../../../src/modules/chats/index.ts';
import { taskTurnHook } from '../../../../src/modules/tasks/index.ts';
import { queued, runningTurn } from '../../../fixtures/chats/queue.ts';
import { type ChatsWorld, chatsWorld, scene, turnRow } from '../../../fixtures/chats/world.ts';
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

/** Marks a running turn done in the database, as a server that died before starting the chat's next turn left it. */
const leaveDone = (turnId: string) =>
  rawDb(w.t.db)
    .update(chatTurns)
    .set({ status: 'done', endedAt: new Date(TEST_NOW) })
    .where(eq(chatTurns.id, turnId));

describe('reapTurns', () => {
  it('fails the waiting turns of chats where nothing runs, and leaves running turns and their waiting turns', async () => {
    const live = await scene(w);
    const running = await runningTurn(w, live);
    const keeps = await queued(w, live, 'And 3 + 3?');
    const idle = await scene(w);
    const finished = await runningTurn(w, idle);
    const left = await queued(w, idle, 'And 5 + 5?');
    await leaveDone(finished.turnId);
    const { logger, lines } = captureLogger();
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger })).toBe(1);
    expect(await turnRow(w.t.db, left.id)).toMatchObject({
      status: 'failed',
      error: SERVER_RESTARTED,
      endedAt: new Date(TEST_NOW),
    });
    expect((await turnRow(w.t.db, running.turnId))?.status).toBe('running');
    expect((await turnRow(w.t.db, keeps.id))?.status).toBe('queued');
    expect(lines.find((line) => line.failed === 1)).toMatchObject({ level: LEVEL.info });
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger })).toBe(0);
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
  /** A task's step turn ended without its next waiting message started: a reply waits in its conversation. */
  async function waitingReply() {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const chat = (await turnRow(w.t.db, start.turnId))?.chatId as string;
    const scene = { company: s.c, chat: { id: chat } } as unknown as Parameters<typeof queued>[1];
    const reply = await queued(w, scene, 'Use staging');
    await leaveDone(start.turnId);
    return { task, reply };
  }

  it('blocks the task whose conversation’s waiting reply a stopped server left', async () => {
    const { task, reply } = await waitingReply();
    const { logger } = captureLogger();
    expect(
      await reapTurns({ db: w.t.db, clock: w.clock, logger, tasks: taskTurnHook({ logger, db: w.t.db }) }),
    ).toBe(1);
    expect((await turnRow(w.t.db, reply.id))?.status).toBe('failed');
    expect(await taskRow(w.t.db, task.id)).toMatchObject({
      stepState: 'blocked',
      blockedReason: 'The server restarted during the turn',
    });
  });

  it('logs a task it cannot tell, and goes on', async () => {
    await waitingReply();
    const { logger, lines } = captureLogger();
    const broken = { prepare: () => Promise.reject(new Error('no tasks here')) } as unknown as TaskTurnHook;
    expect(await reapTurns({ db: w.t.db, clock: w.clock, logger, tasks: broken })).toBe(1);
    expect(
      lines.find((line) => line.msg === 'could not tell the task of a turn a stopped server left'),
    ).toBeDefined();
  });
});
