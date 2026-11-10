import { agents, chats } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatView } from '../../../../src/modules/chats/schemas.ts';
import {
  answeredTurn,
  branch,
  branched,
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
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { auditOf } from '../../../fixtures/machines/machines.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('POST chats/:chatId/branch', () => {
  it("begins a chat with the parent's harness, machine, profile choice and the reply's session, pending its fork", async () => {
    const s = await scene(w);
    const first = await answeredTurn(w, s, reply('4'));
    await rawDb(w.t.db)
      .update(chats)
      .set({ profileId: s.profile.id, profileSetBy: s.company.owner.userId })
      .where(eq(chats.id, s.chat.id));
    const res = await branch(w, s, first.turnId);
    expect(res.status).toBe(201);
    const made = res.body as ChatView;
    expect(made).toMatchObject({
      agentId: s.agentId,
      harness: 'claude_code',
      machineId: s.machineId,
      profileId: s.profile.id,
      profileSetBy: s.company.owner.userId,
      sessionId: PARENT_SESSION,
      title: 'What is 2 + 2? (branch)',
      branchedFromChatId: s.chat.id,
      branchedFromTurnId: first.turnId,
      forkPending: true,
      createdBy: s.company.owner.principalId,
      archivedAt: null,
    });
    expect(made.id).not.toBe(s.chat.id);
    expect(await auditOf(w.t.db, 'chat', made.id)).toEqual([
      'branch agentId',
      'branch harness',
      'branch machineId',
      'branch profileId',
      'branch title',
    ]);
    // The parent is untouched; the branch's detail names it, with its title now.
    expect(await chatRow(w.t.db, s.chat.id)).toMatchObject({ sessionId: PARENT_SESSION, forkPending: false });
    const own = (await as(w, s.company.owner)('GET', chatPath(s.company, made.id))).body as ChatDetailView;
    expect(own.branchedFrom).toEqual({ chatId: s.chat.id, turnId: first.turnId, title: 'What is 2 + 2?' });
    expect(own.turns).toEqual([]);
    const parent = (await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id)))
      .body as ChatDetailView;
    expect(parent.branchedFrom).toBeNull();
  });

  it('is for admins and owners, and 404s an unknown chat or turn', async () => {
    const s = await scene(w);
    const first = await answeredTurn(w, s, reply('4'));
    for (const role of ['member', 'viewer'] as const) {
      expect((await branch(w, s, first.turnId, await addMember(w, s.company, role))).status).toBe(403);
    }
    const admin = await addMember(w, s.company, 'admin');
    expect((await branch(w, s, first.turnId, admin)).status).toBe(201);
    expect(refusal(await branch(w, { ...s, chat: { ...s.chat, id: 'nope' } }, first.turnId))).toEqual([
      404,
      'chat_not_found',
    ]);
    expect(refusal(await branch(w, s, 'nope'))).toEqual([404, 'turn_not_found']);
    const other = await scene(w);
    expect(refusal(await branch(w, { ...s, company: other.company }, first.turnId))).toEqual([
      404,
      'chat_not_found',
    ]);
  });

  it('refuses while a turn runs, a turn that is no finished reply with a session, and an archived agent', async () => {
    const s = await scene(w);
    const first = await answeredTurn(w, s, reply('4'));
    const running = await startedTurn(w, s, 'And 3 + 3?');
    expect(refusal(await branch(w, s, first.turnId))).toEqual([409, 'turn_running']);
    expect(refusal(await branch(w, s, running.turnId))).toEqual([409, 'turn_running']);
    // It fails before Claude Code said its session: nothing to continue.
    sendEvents(s.runner as FakeRunner, running.turnId, [{ type: 'result', ok: false, error: 'boom' }]);
    endTurn(s.runner as FakeRunner, running.turnId, { ok: false, exitCode: 1 });
    await ended(w.t.db, running.turnId);
    expect(refusal(await branch(w, s, running.turnId))).toEqual([409, 'turn_not_branchable']);
    const compact = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/compact'));
    const compactId = (compact.body as { id: string }).id;
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    sendEvents(s.runner as FakeRunner, start.turnId, reply(''));
    endTurn(s.runner as FakeRunner, start.turnId);
    await ended(w.t.db, start.turnId);
    expect(refusal(await branch(w, s, compactId))).toEqual([409, 'turn_not_branchable']);
    await rawDb(w.t.db).update(agents).set({ status: 'archived' }).where(eq(agents.id, s.agentId));
    expect(refusal(await branch(w, s, first.turnId))).toEqual([409, 'agent_archived']);
  });

  it('branches Claude Code from an earlier reply only with its message id and no compaction after it', async () => {
    const s = await scene(w);
    const old = await answeredTurn(w, s, reply('4'));
    const recorded = await answeredTurn(w, s, reply('6', 'msg-2'), 'And 3 + 3?');
    await answeredTurn(w, s, reply('8', 'msg-3'), 'And 4 + 4?');
    expect(refusal(await branch(w, s, old.turnId))).toEqual([409, 'branch_latest_only']);
    expect((await branched(w, s, recorded.turnId)).sessionId).toBe(PARENT_SESSION);
    await answeredTurn(w, s, [
      ...reply('ok', 'msg-4').slice(0, 1),
      { type: 'compact', preTokens: 9, postTokens: 1 },
    ]);
    const res = await branch(w, s, recorded.turnId);
    expect(refusal(res)).toEqual([409, 'branch_latest_only']);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/compacted/);
  });

  it('branches a reply before a Clear as the latest of its own conversation', async () => {
    const s = await scene(w);
    const before = await answeredTurn(w, s, reply('4'));
    expect((await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/clear'))).status).toBe(200);
    await answeredTurn(w, s, reply('6', undefined, 'second-session'), 'And 3 + 3?');
    expect(await branched(w, s, before.turnId)).toMatchObject({
      sessionId: PARENT_SESSION,
      forkPending: true,
    });
  });

  it('branches Codex from the latest reply only', async () => {
    const s = await scene(w, { harness: 'codex' });
    const first = await answeredTurn(w, s, reply('4', undefined, 'codex-thread'));
    const second = await answeredTurn(w, s, reply('6', undefined, 'codex-thread'), 'And 3 + 3?');
    const res = await branch(w, s, first.turnId);
    expect(refusal(res)).toEqual([409, 'branch_latest_only']);
    expect((res.body as { error: { message: string } }).error.message).toMatch(/Codex/);
    expect(await branched(w, s, second.turnId)).toMatchObject({
      harness: 'codex',
      sessionId: 'codex-thread',
      forkPending: true,
    });
  });
});
