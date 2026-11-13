import { seedApiKey, TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatDetailView, ChatView } from '../../../../src/modules/chats/schemas.ts';
import {
  ANSWER,
  agentChatsPath,
  beginChat,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  place,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { auditOf, enroll } from '../../../fixtures/machines/machines.ts';
import { addMember, as, membersCompany } from '../../../fixtures/members/members.ts';
import { makeAgent, seedProfile } from '../../../fixtures/org.ts';
import { bearer } from '../../../fixtures/platform/auth.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe('POST agents/:agentId/chats', () => {
  it("begins a chat on the agent's harness and machine, with no title, session or profile of its own", async () => {
    const s = await scene(w);
    expect(s.chat).toEqual({
      id: expect.any(String),
      agentId: s.agentId,
      harness: 'claude_code',
      machineId: s.machineId,
      profileId: null,
      profileSetBy: null,
      sessionId: null,
      title: null,
      branchedFromChatId: null,
      branchedFromTurnId: null,
      forkPending: false,
      task: null,
      flowId: null,
      overrides: { mode: null, model: null, effort: null },
      createdBy: s.company.owner.principalId,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      archivedAt: null,
    });
    expect(await auditOf(w.t.db, 'chat', s.chat.id)).toEqual([
      'create agentId',
      'create harness',
      'create machineId',
    ]);
  });

  it("takes the caller's own profile, and refuses someone else's, an unknown one and an API key's choice", async () => {
    const s = await scene(w);
    const mine = await seedProfile(w.t.db, s.company.owner.userId);
    const chat = await beginChat(w, s.company, s.agentId, { profileId: mine.id });
    expect(chat).toMatchObject({ profileId: mine.id, profileSetBy: s.company.owner.userId });
    const admin = await addMember(w, s.company, 'admin');
    const owners = await as(w, admin)('POST', agentChatsPath(s.company, s.agentId), { profileId: mine.id });
    expect([owners.status, owners.body]).toMatchObject([403, { error: { code: 'profile_not_yours' } }]);
    const unknown = await as(w, admin)('POST', agentChatsPath(s.company, s.agentId), {
      profileId: '0190f5f0-0000-7000-8000-000000000000',
    });
    expect([unknown.status, unknown.body]).toMatchObject([422, { error: { code: 'profile_not_found' } }]);
    const openai = await seedProfile(w.t.db, s.company.owner.userId, { provider: 'openai' });
    const mismatch = await as(w, s.company.owner)('POST', agentChatsPath(s.company, s.agentId), {
      profileId: openai.id,
    });
    expect([mismatch.status, mismatch.body]).toMatchObject([
      422,
      {
        error: {
          code: 'profile_part_missing',
          message: 'This profile has no Claude part, which a Claude Code agent runs on',
        },
      },
    ]);
    const key = await seedApiKey(w.t.db, s.company.companyId, s.company.owner.principalId);
    const viaKey = await w.t.app.request(agentChatsPath(s.company, s.agentId), {
      method: 'POST',
      headers: { ...bearer(key.key), 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: mine.id }),
    });
    expect(viaKey.status).toBe(403);
  });

  it('is for admins and owners, a 404 for an unknown agent, a 409 without a placement or once archived', async () => {
    const s = await scene(w, { offline: true });
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, s.company, role);
      expect((await as(w, person)('POST', agentChatsPath(s.company, s.agentId), {})).status).toBe(403);
    }
    const admin = await addMember(w, s.company, 'admin');
    expect((await beginChat(w, s.company, s.agentId, {}, admin)).createdBy).toBe(admin.principalId);
    const missing = await as(w, admin)('POST', agentChatsPath(s.company, 'nope'), {});
    expect([missing.status, missing.body]).toMatchObject([404, { error: { code: 'agent_not_found' } }]);
    const unplaced = await makeAgent(w, s.company, s.company.owner, { name: 'Unplaced' });
    const res = await as(w, admin)('POST', agentChatsPath(s.company, unplaced.id), {});
    expect([res.status, res.body]).toMatchObject([409, { error: { code: 'placement_missing' } }]);
    await as(w, s.company.owner)('PATCH', `/api/companies/${s.company.companyId}/agents/${s.agentId}`, {
      status: 'archived',
    });
    const archived = await as(w, admin)('POST', agentChatsPath(s.company, s.agentId), {});
    expect([archived.status, archived.body]).toMatchObject([409, { error: { code: 'agent_archived' } }]);
  });
});

describe('GET agents/:agentId/chats and chats/:chatId', () => {
  it("lists an agent's chats for members, the latest first, without archived ones", async () => {
    const s = await scene(w, { offline: true });
    const later = await beginChat(w, s.company, s.agentId);
    const member = await addMember(w, s.company, 'member');
    const list = await as(w, member)('GET', agentChatsPath(s.company, s.agentId));
    expect((list.body as { chats: ChatView[] }).chats.map((chat) => chat.id)).toEqual([later.id, s.chat.id]);
    await as(w, s.company.owner)('DELETE', chatPath(s.company, later.id));
    const after = await as(w, member)('GET', agentChatsPath(s.company, s.agentId));
    expect((after.body as { chats: ChatView[] }).chats.map((chat) => chat.id)).toEqual([s.chat.id]);
    const viewer = await addMember(w, s.company, 'viewer');
    expect((await as(w, viewer)('GET', agentChatsPath(s.company, s.agentId))).status).toBe(403);
    expect((await as(w, member)('GET', agentChatsPath(s.company, 'nope'))).status).toBe(404);
  });

  it('shows a chat with its turns and their events, in order, and never a secret', async () => {
    const s = await scene(w);
    const start = await startedTurn(w, s);
    sendEvents(s.runner as never, start.turnId, ANSWER);
    endTurn(s.runner as never, start.turnId);
    await ended(w.t.db, start.turnId);
    const res = await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id));
    const chat = res.body as ChatDetailView;
    expect(chat).toMatchObject({ title: 'What is 2 + 2?', sessionId: 'b4c1f0e2-session' });
    expect(chat.turns.map((turn) => [turn.seq, turn.status, turn.resultText])).toEqual([[1, 'done', '4']]);
    expect(chat.turns[0]?.events.map((event) => event.event.type)).toEqual([
      'session',
      'text',
      'usage',
      'result',
    ]);
    expect(JSON.stringify(chat)).not.toContain('SETUPtoken');
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('GET', chatPath(other, s.chat.id))).body).toMatchObject({
      error: { code: 'chat_not_found' },
    });
  });
});

describe('PATCH and DELETE chats/:chatId', () => {
  it("renames a chat, chooses the caller's own profile, and any admin takes it off", async () => {
    const s = await scene(w, { offline: true });
    const mine = await seedProfile(w.t.db, s.company.owner.userId);
    const owner = as(w, s.company.owner);
    const res = await owner('PATCH', chatPath(s.company, s.chat.id), {
      title: '  Planning  ',
      profileId: mine.id,
    });
    expect(res.body).toMatchObject({
      title: 'Planning',
      profileId: mine.id,
      profileSetBy: s.company.owner.userId,
    });
    const same = await owner('PATCH', chatPath(s.company, s.chat.id), { title: 'Planning' });
    expect(same.status).toBe(200);
    const admin = await addMember(w, s.company, 'admin');
    const theirs = await as(w, admin)('PATCH', chatPath(s.company, s.chat.id), { profileId: mine.id });
    expect(theirs.status).toBe(200);
    const other = await seedProfile(w.t.db, s.company.owner.userId);
    const notYours = await as(w, admin)('PATCH', chatPath(s.company, s.chat.id), { profileId: other.id });
    expect([notYours.status, notYours.body]).toMatchObject([403, { error: { code: 'profile_not_yours' } }]);
    const off = await as(w, admin)('PATCH', chatPath(s.company, s.chat.id), { profileId: null });
    expect(off.body).toMatchObject({ profileId: null, profileSetBy: null });
    // A Claude Code chat takes only a profile with a Claude part: the picker's choices are those.
    const openai = await seedProfile(w.t.db, s.company.owner.userId, { provider: 'openai' });
    const mismatch = await owner('PATCH', chatPath(s.company, s.chat.id), { profileId: openai.id });
    expect([mismatch.status, mismatch.body]).toMatchObject([
      422,
      { error: { code: 'profile_part_missing' } },
    ]);
    expect(await auditOf(w.t.db, 'chat', s.chat.id)).toContain('update profileId');
    expect((await owner('PATCH', chatPath(s.company, 'nope'), { title: 'x' })).status).toBe(404);
    const member = await addMember(w, s.company, 'member');
    expect((await as(w, member)('PATCH', chatPath(s.company, s.chat.id), { title: 'x' })).status).toBe(403);
    expect((await owner('PATCH', chatPath(s.company, s.chat.id), { title: '' })).status).toBe(400);
  });

  it('archives a chat once (204, audited), keeps it readable, and refuses its new turns', async () => {
    const s = await scene(w);
    const owner = as(w, s.company.owner);
    expect((await owner('DELETE', chatPath(s.company, s.chat.id))).status).toBe(204);
    expect((await owner('DELETE', chatPath(s.company, s.chat.id))).status).toBe(204);
    expect((await owner('GET', chatPath(s.company, s.chat.id))).body).toMatchObject({ archivedAt: TEST_NOW });
    expect(await auditOf(w.t.db, 'chat', s.chat.id)).toContain('archive archivedAt');
    const turn = await owner('POST', chatPath(s.company, s.chat.id, '/turns'), { prompt: 'hi' });
    expect([turn.status, turn.body]).toMatchObject([409, { error: { code: 'chat_archived' } }]);
    expect((await owner('DELETE', chatPath(s.company, 'nope'))).status).toBe(404);
  });

  it('keeps a chat on the machine it began on: a placement moved since is machine_changed', async () => {
    const s = await scene(w);
    const company = s.company;
    const { machineId } = await enroll(w, company);
    await place(w, company, s.agentId, { machineId });
    const res = await as(w, company.owner)('POST', chatPath(company, s.chat.id, '/turns'), { prompt: 'hi' });
    expect([res.status, res.body]).toMatchObject([409, { error: { code: 'machine_changed' } }]);
    expect((res.body as { error: { message: string } }).error.message).toContain('start a new chat');
  });
});
