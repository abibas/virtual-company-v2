import { tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { forkOf } from '../../../../src/modules/chats/service/branch.ts';
import {
  answeredTurn,
  branched,
  onChat,
  PARENT_SESSION,
  refusal,
  reply,
} from '../../../fixtures/chats/branch.ts';
import {
  type ChatsWorld,
  chatPath,
  chatRow,
  chatsWorld,
  ended,
  endTurn,
  type Scene,
  scene,
  sendEvents,
  sendPrompt,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';

// A branch's first turn (docs/harness.md "Branching"): the spec forks the parent's session, up to the reply when the
// parent went on; the forked session ends `fork_pending`; what refuses that turn, the terminal and a Clear meanwhile.

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** The branch's first turn answered on `session`: its `turn.start`. */
async function forkedTurn(s: Scene, session: string) {
  const start = await startedTurn(w, s, 'Try 5 instead');
  sendEvents(s.runner as FakeRunner, start.turnId, reply('10', undefined, session));
  endTurn(s.runner as FakeRunner, start.turnId);
  await ended(w.t.db, start.turnId);
  return start;
}

describe("a branch's first turn", () => {
  it("forks the parent's session, and the forked session ends the wait; the next turn resumes it", async () => {
    const s = await scene(w);
    const reply4 = await answeredTurn(w, s, reply('4'));
    const b = onChat(s, await branched(w, s, reply4.turnId));
    const first = await forkedTurn(b, 'forked-session');
    expect(first.spec).toMatchObject({
      sessionId: PARENT_SESSION,
      forkSession: true,
      prompt: 'Try 5 instead',
    });
    expect(first.spec).not.toHaveProperty('resumeAt');
    expect(await chatRow(w.t.db, b.chat.id)).toMatchObject({
      sessionId: 'forked-session',
      forkPending: false,
    });
    expect(await chatRow(w.t.db, s.chat.id)).toMatchObject({ sessionId: PARENT_SESSION, forkPending: false });
    const next = await answeredTurn(w, b, reply('12', undefined, 'forked-session'), 'And 6?');
    expect(next.spec).toMatchObject({ sessionId: 'forked-session' });
    expect(next.spec).not.toHaveProperty('forkSession');
  });

  it('resumes up to the reply when later turns of the parent ran on its session, read at the turn', async () => {
    const s = await scene(w);
    const reply4 = await answeredTurn(w, s, reply('4', 'msg-1'));
    const b = onChat(s, await branched(w, s, reply4.turnId));
    // The parent goes on after the branch was made: the fork is still cut at the reply.
    await answeredTurn(w, s, reply('6', 'msg-2'), 'And 3 + 3?');
    const first = await forkedTurn(b, 'forked-session');
    expect(first.spec).toMatchObject({ sessionId: PARENT_SESSION, forkSession: true, resumeAt: 'msg-1' });
  });

  it("keeps waiting when the session said is the parent's own, so the next turn forks again", async () => {
    const s = await scene(w);
    const reply4 = await answeredTurn(w, s, reply('4'));
    const b = onChat(s, await branched(w, s, reply4.turnId));
    await forkedTurn(b, PARENT_SESSION);
    expect(await chatRow(w.t.db, b.chat.id)).toMatchObject({ sessionId: PARENT_SESSION, forkPending: true });
    expect((await startedTurn(w, b, 'Again')).spec).toMatchObject({ forkSession: true });
  });

  it('is refused on a runner that cannot fork, and when the reply can no longer be reached (Codex)', async () => {
    const old = await scene(w, { caps: { forks: false } });
    const oldReply = await answeredTurn(w, old, reply('4'));
    const oldBranch = onChat(old, await branched(w, old, oldReply.turnId));
    expect(refusal(await sendPrompt(w, oldBranch, 'Try 5'))).toEqual([409, 'runner_outdated']);
    const s = await scene(w, { harness: 'codex' });
    const latest = await answeredTurn(w, s, reply('4', undefined, 'codex-thread'));
    const b = onChat(s, await branched(w, s, latest.turnId));
    await answeredTurn(w, s, reply('6', undefined, 'codex-thread'), 'And 3 + 3?');
    const res = await sendPrompt(w, b, 'Try 5');
    expect(refusal(res)).toEqual([409, 'branch_latest_only']);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/went on since/);
  });

  it('forks a Codex thread whole while the reply is still its latest', async () => {
    const s = await scene(w, { harness: 'codex' });
    const latest = await answeredTurn(w, s, reply('4', undefined, 'codex-thread'));
    const b = onChat(s, await branched(w, s, latest.turnId));
    expect((await forkedTurn(b, 'codex-fork')).spec).toMatchObject({
      sessionId: 'codex-thread',
      forkSession: true,
    });
    expect(await chatRow(w.t.db, b.chat.id)).toMatchObject({ sessionId: 'codex-fork', forkPending: false });
  });

  it('opens no terminal before the fork, and a Clear meanwhile starts the branch anew', async () => {
    const s = await scene(w);
    const reply4 = await answeredTurn(w, s, reply('4'));
    const b = onChat(s, await branched(w, s, reply4.turnId));
    const ticket = await as(w, s.company.owner)('POST', chatPath(s.company, b.chat.id, '/terminal-tickets'));
    expect(refusal(ticket)).toEqual([409, 'branch_pending']);
    expect((await as(w, s.company.owner)('POST', chatPath(s.company, b.chat.id, '/clear'))).status).toBe(200);
    expect(await chatRow(w.t.db, b.chat.id)).toMatchObject({ sessionId: null, forkPending: false });
    const fresh = (await startedTurn(w, b, 'Start over')).spec;
    expect(fresh).toMatchObject({ sessionId: null });
    expect(fresh).not.toHaveProperty('forkSession');
  });
});

describe('forkOf', () => {
  it('forks the whole session when the reply or the parent is gone', async () => {
    const s = await scene(w);
    const reply4 = await answeredTurn(w, s, reply('4', 'msg-1'));
    const b = await branched(w, s, reply4.turnId);
    const t = await tenant(w.t.db, s.company.companyId);
    const row = await chatRow(w.t.db, b.id);
    if (row === undefined) throw new Error('no branch');
    expect(await forkOf(t, row)).toEqual({ ok: true, fork: { forkSession: true } });
    expect(await forkOf(t, { ...row, branchedFromTurnId: null })).toEqual({
      ok: true,
      fork: { forkSession: true },
    });
    expect(await forkOf(t, { ...row, branchedFromChatId: null })).toEqual({
      ok: true,
      fork: { forkSession: true },
    });
    expect(await forkOf(t, { ...row, forkPending: false })).toEqual({ ok: true, fork: {} });
  });
});
