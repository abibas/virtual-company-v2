import { agents, chats, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatView } from '../../../../src/modules/chats/schemas.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  type Scene,
  scene,
  sendEvents,
  sendPrompt,
  startedTurn,
  turnRow,
} from '../../../fixtures/chats/world.ts';
import { auditOf } from '../../../fixtures/machines/machines.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import { seedProfile } from '../../../fixtures/org.ts';
import { conversationsOf, finish, runScene, stepStateIs } from '../../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** Sets the chat's overrides as the owner (or `person`): the status and the body. */
const override = (s: Pick<Scene, 'company' | 'chat'>, body: unknown, person = s.company.owner) =>
  as(w, person)('PATCH', chatPath(s.company, s.chat.id, '/overrides'), body);

/** The runner answers the turn and it ends. */
async function answered(s: Scene, turnId: string) {
  sendEvents(s.runner as FakeRunner, turnId, ANSWER);
  endTurn(s.runner as FakeRunner, turnId);
  await ended(w.t.db, turnId);
}

describe('PATCH chats/:chatId/overrides', () => {
  it("sets the chat's mode, model and effort for its next turns, audited, and the detail shows the profile's", async () => {
    const s = await scene(w);
    const res = await override(s, { mode: 'plan', model: 'claude-sonnet-5-5', effort: 'low' });
    expect(res.status).toBe(200);
    expect((res.body as ChatView).overrides).toEqual({
      mode: 'plan',
      model: 'claude-sonnet-5-5',
      effort: 'low',
    });
    expect(await auditOf(w.t.db, 'chat', s.chat.id)).toEqual(
      expect.arrayContaining(['update mode', 'update model', 'update effort']),
    );
    const detail = (await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id)))
      .body as ChatDetailView;
    expect(detail.overrides).toEqual({ mode: 'plan', model: 'claude-sonnet-5-5', effort: 'low' });
    expect(detail.profileRuns).toEqual({ mode: 'manual', model: 'claude-opus-5-5', effort: 'high' });

    const start = await startedTurn(w, s);
    expect(start.spec).toMatchObject({
      model: 'claude-sonnet-5-5',
      effort: 'low',
      permissionMode: 'plan',
      permissionPolicy: 'ask',
    });
    expect(await turnRow(w.t.db, start.turnId)).toMatchObject({
      mode: 'plan',
      model: 'claude-sonnet-5-5',
      effort: 'low',
    });
  });

  it("clears each with null (the profile's again), keeps what is left out, and writes nothing unchanged", async () => {
    const s = await scene(w, { mode: 'acceptEdits' });
    await override(s, { mode: 'bypassPermissions', effort: 'max' });
    const same = await override(s, { mode: 'bypassPermissions' });
    expect((same.body as ChatView).overrides).toEqual({
      mode: 'bypassPermissions',
      model: null,
      effort: 'max',
    });
    const cleared = await override(s, { mode: null });
    expect((cleared.body as ChatView).overrides).toEqual({ mode: null, model: null, effort: 'max' });
    expect((await auditOf(w.t.db, 'chat', s.chat.id)).filter((row) => row === 'update mode')).toHaveLength(2);
    const start = await startedTurn(w, s);
    expect(start.spec).toMatchObject({
      permissionMode: 'acceptEdits',
      effort: 'max',
      model: 'claude-opus-5-5',
    });
  });

  it('is taken while a turn runs, from the next turn on; the running turn keeps what it started with', async () => {
    const s = await scene(w, { mode: 'bypassPermissions' });
    const first = await startedTurn(w, s);
    expect(first.spec).toMatchObject({ permissionMode: 'bypassPermissions', permissionPolicy: 'bypass' });
    expect((await override(s, { mode: 'manual', model: 'claude-haiku-5-5' })).status).toBe(200);
    await answered(s, first.turnId);
    expect(await turnRow(w.t.db, first.turnId)).toMatchObject({
      mode: 'bypassPermissions',
      model: 'claude-opus-5-5',
    });
    const next = await startedTurn(w, s, 'And now?');
    expect(next.spec).toMatchObject({
      permissionMode: 'manual',
      permissionPolicy: 'ask',
      model: 'claude-haiku-5-5',
    });
  });

  it("maps a Codex chat's modes, and refuses what does not fit its AI", async () => {
    const s = await scene(w, { harness: 'codex' });
    for (const [body, code] of [
      [{ mode: 'plan' }, 'mode_unsupported'],
      [{ model: 'claude-opus-5-5' }, 'model_unsupported'],
      [{ model: 'gpt-7-preview' }, 'model_unsupported'],
      [{ model: 'gpt-5.5', effort: 'ultra' }, 'effort_unsupported'],
    ] as const) {
      const res = await override(s, body);
      expect([res.status, res.body]).toMatchObject([422, { error: { code } }]);
    }
    expect((await override(s, { effort: 'ultra' })).status).toBe(200);
    const moved = await override(s, { model: 'gpt-5.5' });
    expect([moved.status, moved.body]).toMatchObject([422, { error: { code: 'effort_unsupported' } }]);
    const res = await override(s, { mode: 'full', model: 'gpt-5.5', effort: 'xhigh' });
    expect(res.status).toBe(200);
    const start = await startedTurn(w, s);
    expect(start.spec).toMatchObject({
      model: 'gpt-5.5',
      effort: 'xhigh',
      permissionMode: 'full',
      permissionPolicy: 'bypass',
    });
  });

  it('refuses a body that does not fit (400), and anyone who may not send it messages', async () => {
    const s = await scene(w);
    for (const body of [{}, { mode: 'yolo' }, { effort: 'turbo' }, { model: '-x' }, { colour: 'red' }]) {
      expect(await override(s, body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, s.company, role);
      expect(await override(s, { mode: 'plan' }, person)).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    const admin = await addMember(w, s.company, 'admin');
    expect((await override(s, { mode: 'plan' }, admin)).status).toBe(200);
    const other = await scene(w);
    expect(await override({ company: s.company, chat: other.chat }, { mode: 'plan' })).toMatchObject({
      status: 404,
      body: { error: { code: 'chat_not_found' } },
    });
    expect((await as(w, s.company.owner)('DELETE', chatPath(s.company, s.chat.id))).status).toBe(204);
    expect(await override(s, { mode: 'auto' })).toMatchObject({
      status: 409,
      body: { error: { code: 'chat_archived' } },
    });
  });
});

describe('a provider switch', () => {
  it("clears the overrides when the chat's profile becomes one of another AI, and keeps them otherwise", async () => {
    const s = await scene(w);
    const owner = s.company.owner;
    const own = await seedProfile(w.t.db, owner.userId, { model: 'claude-opus-5-5' });
    const patch = (body: unknown) => as(w, owner)('PATCH', chatPath(s.company, s.chat.id), body);
    expect((await patch({ profileId: own.id })).status).toBe(200);
    await override(s, { mode: 'plan', model: 'claude-haiku-5-5' });
    const another = await seedProfile(w.t.db, owner.userId);
    const kept = await patch({ profileId: another.id });
    expect((kept.body as ChatView).overrides).toEqual({
      mode: 'plan',
      model: 'claude-haiku-5-5',
      effort: null,
    });
    // The agent moves to an OpenAI profile (its harness follows); back on the agent's, the chat's overrides go.
    const openai = await seedProfile(w.t.db, owner.userId, { provider: 'openai' });
    const t = await tenant(w.t.db, s.company.companyId);
    await t.update(agents, { profileId: openai.id, harness: 'codex' }, eq(agents.id, s.agentId));
    const switched = await patch({ profileId: null });
    expect(switched.status).toBe(200);
    expect((switched.body as ChatView).overrides).toEqual({ mode: null, model: null, effort: null });
    expect(await auditOf(w.t.db, 'chat', s.chat.id)).toEqual(
      expect.arrayContaining(['update profileId', 'update mode', 'update model']),
    );
  });
});

describe("a task's conversation", () => {
  it("takes no overrides, and its turns run on the profile's even when a chat row says otherwise", async () => {
    const s = await runScene(w);
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Develop').id,
    });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec).toMatchObject({ permissionMode: 'manual', model: 'claude-opus-5-5' });
    finish(s.runner, start, 'Round one.');
    await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
    const [conversation] = await conversationsOf(w.t.db, task.id);
    const chat = { company: s.c, chat: conversation as unknown as ChatView };
    expect(await override(chat, { mode: 'plan' })).toMatchObject({
      status: 409,
      body: { error: { code: 'overrides_unsupported' } },
    });
    await rawDb(w.t.db)
      .update(chats)
      .set({ mode: 'bypassPermissions', model: 'claude-haiku-5-5' })
      .where(eq(chats.id, chat.chat.id));
    expect((await sendPrompt(w, chat, 'Use the staging database')).status).toBe(202);
    const replied = await s.runner.frames.next('turn.start');
    expect(replied.spec).toMatchObject({
      permissionMode: 'manual',
      permissionPolicy: 'ask',
      model: 'claude-opus-5-5',
    });
  });
});
