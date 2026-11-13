import { type ChatTurn, chats, chatTurns, machines, type TenantDb, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { TurnEvent } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { captureLogger } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sessionLostNotice } from '../../../../src/modules/chats/rules/recap.ts';
import { chatsLive } from '../../../../src/modules/chats/service/live.ts';
import type { CredentialsForHarness } from '../../../../src/modules/credentials/index.ts';
import { answeredTurn, branched, onChat, PARENT_SESSION, reply } from '../../../fixtures/chats/branch.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatRow,
  chatsWorld,
  ended,
  endTurn,
  eventRows,
  type Scene,
  scene,
  sendEvents,
  startedTurn,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import { answer, conversationsOf, finish, runScene, stepStateIs } from '../../../fixtures/runs.ts';
import { historyOf, makeTask, moved, stepOf } from '../../../fixtures/tasks.ts';

/**
 * A lost conversation (docs/harness.md "A lost conversation"): a turn the runner ends `session_missing` starts again,
 * once, under its own id after the end's ack, on a fresh conversation whose prompt recaps the chat so far; the chat
 * forgets the lost session and saves the new one, the thread gets a notice, and the runner numbers after it. A task
 * step's Keep conversation goes the same way. On PGlite with `FakeRunner`.
 */

const KEEPS = { reattach: true } as const;
const MISSING = 'session_missing: No conversation found with session ID: b4c1f0e2-session';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
});
afterAll(() => w.close());

/** A chat that had one exchange ("What is 2 + 2?" → "4") on session `b4c1f0e2-session`, and its second turn sent. */
async function secondTurn(s: Scene, prompt = 'And 3 + 3?'): Promise<TurnStart> {
  const runner = s.runner as FakeRunner;
  const first = await startedTurn(w, s);
  const tool = { type: 'tool', id: 'toolu_1', name: 'Bash', summary: 'echo $((2 + 2))' } as const;
  sendEvents(runner, first.turnId, [ANSWER[0] as TurnEvent, tool, ...ANSWER.slice(1)]);
  endTurn(runner, first.turnId);
  await ended(w.t.db, first.turnId);
  const second = await startedTurn(w, s, prompt);
  expect(second.spec.sessionId).toBe('b4c1f0e2-session');
  return second;
}

/** A running turn of the scene's chat, recorded straight in the database (no runner involved). */
async function recordedTurn(t: TenantDb, s: Scene): Promise<ChatTurn> {
  const id = newId();
  await t.insert(chatTurns, {
    id,
    chatId: s.chat.id,
    seq: 1,
    prompt: 'hi',
    status: 'running',
    startedAt: w.clock(),
    createdBy: s.company.owner.principalId,
  });
  return (await turnRow(w.t.db, id)) as ChatTurn;
}

const machineName = async (s: Scene) =>
  (await rawDb(w.t.db).select().from(machines).where(eq(machines.id, s.machineId)))[0] as { name: string };

describe('a chat turn whose saved conversation is gone', () => {
  it('starts again after the ack on a fresh conversation with a recap, a notice, and the new session stored', async () => {
    const s = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const second = await secondTurn(s);
    endTurn(runner, second.turnId, { ok: false, exitCode: 1, error: MISSING });
    await runner.frames.next('turn.ack', (frame) => frame.turnId === second.turnId);
    const again = await runner.frames.next('turn.start');
    expect(again).toMatchObject({ turnId: second.turnId, afterSeq: 1 });
    // The ack first: the runner frees the turn's id before it starts again under it.
    const types = runner.frames.all.map((frame) => frame.type);
    expect(types.lastIndexOf('turn.ack')).toBeLessThan(types.lastIndexOf('turn.start'));
    expect(again.spec.sessionId).toBeNull();
    expect(again.spec).not.toHaveProperty('forkSession');
    // Prompts and final replies only: no tool call of the first turn.
    expect(again.spec.prompt).toContain('<recap>\nPerson: What is 2 + 2?\nYou: 4\n</recap>');
    expect(again.spec.prompt).not.toContain('echo');
    expect(again.spec.prompt.endsWith("The person's new message:\n\nAnd 3 + 3?")).toBe(true);
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBeNull();
    const { name } = await machineName(s);
    expect((await eventRows(w.t.db, second.turnId)).map((row) => [row.seq, row.event])).toEqual([
      [1, { type: 'notice', level: 'info', message: sessionLostNotice(name, true) }],
    ]);
    expect(sessionLostNotice('Docker runner', true)).toBe(
      'The saved conversation on Docker runner was gone, so this chat started a fresh one with a recap of the last messages.',
    );
    expect((await turnRow(w.t.db, second.turnId))?.status).toBe('running');
    sendEvents(
      runner,
      second.turnId,
      [{ type: 'session', sessionId: 'fresh-session' }, ...ANSWER.slice(1)],
      2,
    );
    endTurn(runner, second.turnId);
    expect(await ended(w.t.db, second.turnId)).toMatchObject({ status: 'done', resultText: '4' });
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBe('fresh-session');
    expect((await eventRows(w.t.db, second.turnId)).map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('fails as before when the fresh start says so too, and never starts a third time', async () => {
    const s = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const second = await secondTurn(s);
    endTurn(runner, second.turnId, { ok: false, exitCode: 1, error: MISSING });
    const again = await runner.frames.next('turn.start');
    endTurn(runner, again.turnId, { ok: false, exitCode: 1, error: MISSING });
    expect(await ended(w.t.db, second.turnId)).toMatchObject({ status: 'failed', error: MISSING });
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBeNull();
    await expect(runner.frames.next('turn.start', () => true, 100)).rejects.toThrow(/No turn.start frame/);
  });

  it('is any other failure for a Compact, and for a turn a person stopped', async () => {
    const s = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const second = await secondTurn(s);
    sendEvents(runner, second.turnId, ANSWER);
    endTurn(runner, second.turnId);
    await ended(w.t.db, second.turnId);
    const compact = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/compact'));
    expect(compact.status).toBe(202);
    const start = await runner.frames.next('turn.start');
    endTurn(runner, start.turnId, { ok: false, exitCode: 1, error: MISSING });
    expect(await ended(w.t.db, start.turnId)).toMatchObject({ status: 'failed', error: MISSING });
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBe('b4c1f0e2-session');
    const third = await startedTurn(w, s, 'Stop this');
    const stop = await as(w, s.company.owner)(
      'POST',
      chatPath(s.company, s.chat.id, `/turns/${third.turnId}/stop`),
    );
    expect(stop.status).toBe(202);
    await runner.frames.next('turn.stop');
    endTurn(runner, third.turnId, { ok: false, exitCode: 1, error: MISSING });
    expect(await ended(w.t.db, third.turnId)).toMatchObject({ status: 'stopped' });
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBe('b4c1f0e2-session');
  });

  it('starts afresh with no recap when nothing finished before it, saying so', async () => {
    const s = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const first = await startedTurn(w, s);
    sendEvents(runner, first.turnId, ANSWER.slice(0, 1));
    endTurn(runner, first.turnId, { ok: false, exitCode: 1, error: MISSING });
    const again = await runner.frames.next('turn.start');
    expect(again.spec.prompt).toBe('What is 2 + 2?');
    expect(again.afterSeq).toBe(2);
    const { name } = await machineName(s);
    expect((await eventRows(w.t.db, first.turnId)).at(-1)?.event).toMatchObject({
      message: sessionLostNotice(name, false),
    });
  });
});

describe('a branch whose parent conversation is gone', () => {
  it("forks nothing: its first turn starts afresh with the parent's turns up to the reply it branched from", async () => {
    const s = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const first = await answeredTurn(w, s, reply('4', 'msg-1'));
    await answeredTurn(w, s, reply('6', 'msg-2'), 'And 3 + 3?');
    const child = onChat(s, await branched(w, s, first.turnId));
    const start = await startedTurn(w, child, 'Then 4 + 4?');
    expect(start.spec).toMatchObject({ sessionId: PARENT_SESSION, forkSession: true });
    endTurn(runner, start.turnId, { ok: false, exitCode: 1, error: MISSING });
    const again = await runner.frames.next('turn.start', (frame) => frame.turnId === start.turnId);
    expect(again.spec).toMatchObject({ sessionId: null });
    expect(again.spec).not.toHaveProperty('forkSession');
    expect(again.spec.prompt).toContain('<recap>\nPerson: What is 2 + 2?\nYou: 4\n</recap>');
    expect(again.spec.prompt).not.toContain('3 + 3');
    expect(await chatRow(w.t.db, child.chat.id)).toMatchObject({ sessionId: null, forkPending: false });
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBe(PARENT_SESSION);
  });
});

describe('a fresh start that cannot be made', () => {
  it('leaves the turn to fail as before when the agent can no longer run, and logs a failure to start', async () => {
    const s = await scene(w, { caps: KEEPS });
    const runner = s.runner as FakeRunner;
    const second = await secondTurn(s);
    await rawDb(w.t.db).update(chats).set({ harness: 'codex' }).where(eq(chats.id, s.chat.id));
    endTurn(runner, second.turnId, { ok: false, exitCode: 1, error: MISSING });
    expect(await ended(w.t.db, second.turnId)).toMatchObject({ status: 'failed', error: MISSING });
    expect((await chatRow(w.t.db, s.chat.id))?.sessionId).toBe('b4c1f0e2-session');
  });

  it('fails the turn when starting afresh throws, logging why', async () => {
    const { logger, lines } = captureLogger();
    const live = chatsLive({ logger, clock: w.clock, credentials: {} as CredentialsForHarness });
    live.onSessionLost(async () => {
      throw new Error('boom');
    });
    const s = await scene(w, { offline: true });
    const t = await tenant(w.t.db, s.company.companyId);
    const turn = await recordedTurn(t, s);
    const used = {
      credentialId: s.credential?.id as string,
      ownerUserId: s.company.owner.userId,
      kind: 'claude_setup_token' as const,
    };
    const sink = live.sink(t, turn, used);
    expect(await sink.end({ ok: false, exitCode: 1, error: 'session_missing' })).toBeUndefined();
    expect(await turnRow(w.t.db, turn.id)).toMatchObject({ status: 'failed', error: 'session_missing' });
    expect(lines.map((line) => line.msg)).toContain('chats: could not start a lost conversation afresh');
  });
});

describe("a task step's Keep conversation whose saved conversation is gone", () => {
  it("starts its next round afresh with the step's own history, and the task hears one end", async () => {
    const s = await runScene(w, { caps: KEEPS });
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Code review').id,
    });
    finish(s.runner, await s.runner.frames.next('turn.start'), 'SEND BACK', 'review-1');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'send_back', reason: 'Tests fail' });
    finish(s.runner, await s.runner.frames.next('turn.start'), 'Fixed.', 'develop-1');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on' });
    const round2 = await s.runner.frames.next('turn.start');
    expect(round2.spec.sessionId).toBe('review-1');
    endTurn(s.runner, round2.turnId, {
      ok: false,
      exitCode: 1,
      error: MISSING.replace('b4c1f0e2-session', 'review-1'),
    });
    const again = await s.runner.frames.next('turn.start');
    expect(again).toMatchObject({ turnId: round2.turnId, afterSeq: 1, spec: { sessionId: null } });
    expect(again.spec.prompt).toContain('You: SEND BACK');
    expect(again.spec.prompt.endsWith(round2.spec.prompt)).toBe(true);
    expect(again.spec.artifacts).toEqual(round2.spec.artifacts);
    expect((await stepStateIs(w.t.db, task.id, 'working')).stepState).toBe('working');
    sendEvents(s.runner, again.turnId, answer('PASS', 'review-2'), 2);
    endTurn(s.runner, again.turnId);
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const reviews = (await conversationsOf(w.t.db, task.id)).filter((chat) => chat.sessionId === 'review-2');
    expect(reviews).toHaveLength(1);
    const blocked = (await historyOf(w.t.db, task.id)).filter(([kind]) => kind === 'blocked');
    expect(blocked).toEqual([]);
  });
});
