import { flows, tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatListItemView } from '../../../../src/modules/chats/schemas/activity.ts';
import type { ChatDetailView, ChatView } from '../../../../src/modules/chats/schemas.ts';
import { chatRowOf } from '../../../fixtures/chats/reports.ts';
import { openStream } from '../../../fixtures/chats/stream.ts';
import {
  agentChatsPath,
  beginChat,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  type Scene,
  scene,
} from '../../../fixtures/chats/world.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';

/**
 * Every route of a chat, locked to its people (2026-11-14, docs/harness.md "Who is in a chat"): a member who is not in a
 * message chat gets the same 404 as an unknown chat, on each route; a company owner who is not in it reads it (the
 * owner view, and "Other people's chats" on the agent's page) and is told to add themselves on each route that writes;
 * Add me puts them in. Never another person's chat in anyone's own list.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const T = '/turns/019a6c1d-9e8f-7a6b-8c5d-4e3f2a1b0c9d';

/** Each route that writes in a chat: its method, the path after the chat, its body. */
const WRITES: readonly [string, string, unknown][] = [
  ['PATCH', '', { title: 'Mine now' }],
  ['DELETE', '', undefined],
  ['PATCH', '/overrides', { mode: 'plan' }],
  ['POST', '/branch', { turnId: 'nope' }],
  ['POST', '/turns', { prompt: 'hi' }],
  ['POST', `${T}/stop`, undefined],
  ['PATCH', T, { prompt: 'edited' }],
  ['DELETE', T, undefined],
  ['POST', `${T}/deliver`, { delivery: 'now' }],
  ['POST', '/compact', undefined],
  ['POST', '/clear', undefined],
  ['POST', '/answers', { questionId: 'q1', answers: [] }],
  ['POST', '/slack-messages', { text: 'hi' }],
  ['DELETE', '/people/nope', undefined],
];

/** Each route that only reads one. */
const READS: readonly string[] = ['', '/turns?beforeSeq=2'];

const code = (res: { body: unknown }) => (res.body as { error?: { code: string } } | null)?.error?.code;

/** A chat an admin began alone, with someone else of each kind around. */
async function theirChat(s: Scene) {
  const admin = await addMember(w, s.company, 'admin');
  const outsider = await addMember(w, s.company, 'admin');
  const chat = await beginChat(w, s.company, s.agentId, {}, admin);
  return { admin, outsider, chat };
}

const call = (s: Scene, chat: ChatView, person: Person, route: readonly [string, string, unknown]) =>
  as(w, person)(route[0], chatPath(s.company, chat.id, route[1]), route[2]);

describe("a chat's routes", () => {
  it('are a 404 on every route for a member who is not in the chat, as for an unknown chat', async () => {
    const s = await scene(w, { offline: true });
    const { outsider, chat } = await theirChat(s);
    for (const route of [...READS.map((path) => ['GET', path, undefined] as const), ...WRITES]) {
      const res = await call(s, chat, outsider, route);
      expect([route[0], route[1], res.status, code(res)]).toEqual([
        route[0],
        route[1],
        404,
        'chat_not_found',
      ]);
    }
    const stream = await openStream(w.t.app, chatPath(s.company, chat.id, '/stream'), {
      authorization: `Bearer fake:${outsider.subject}`,
    });
    expect(stream.status).toBe(404);
    await stream.close();
    const tickets = await as(w, outsider)('POST', chatPath(s.company, chat.id, '/terminal-tickets'));
    expect(code(tickets)).toBe('forbidden');
  });

  it("let the chat's people through to the route itself", async () => {
    const s = await scene(w, { offline: true });
    const { admin, chat } = await theirChat(s);
    for (const route of WRITES) {
      const res = await call(s, chat, admin, route);
      expect([route[0], route[1], ['chat_not_found', 'not_in_chat'].includes(code(res) ?? '')]).toEqual([
        route[0],
        route[1],
        false,
      ]);
    }
  });

  it('let an owner who is not in it read it, refuse their every write, and let Add me put them in', async () => {
    const s = await scene(w, { offline: true });
    const { admin, chat } = await theirChat(s);
    const owner = s.company.owner;
    const read = await as(w, owner)('GET', chatPath(s.company, chat.id));
    const shown = read.body as ChatDetailView;
    expect([read.status, shown.ownerView, shown.people.map((p) => p.principalId)]).toEqual([
      200,
      true,
      [admin.principalId],
    ]);
    expect((await as(w, owner)('GET', chatPath(s.company, chat.id, READS[1]))).status).toBe(200);
    const stream = await openStream(w.t.app, chatPath(s.company, chat.id, '/stream'), {
      authorization: `Bearer fake:${owner.subject}`,
    });
    expect(stream.status).toBe(200);
    await stream.close();
    for (const route of [...WRITES, ['POST', '/terminal-tickets', undefined] as const]) {
      const res = await call(s, chat, owner, route);
      expect([route[0], route[1], res.status, code(res)]).toEqual([route[0], route[1], 403, 'not_in_chat']);
    }
    const others = await as(w, admin)('POST', chatPath(s.company, chat.id, '/people'), {
      principalIds: [owner.principalId],
    });
    expect(others.status).toBe(200);
    const after = (await as(w, owner)('GET', chatPath(s.company, chat.id))).body as ChatDetailView;
    expect(after.ownerView).toBe(false);
  });

  it('let an owner add only themselves while not in it', async () => {
    const s = await scene(w, { offline: true });
    const { outsider, chat } = await theirChat(s);
    const owner = s.company.owner;
    const people = (principalIds: string[]) =>
      as(w, owner)('POST', chatPath(s.company, chat.id, '/people'), { principalIds });
    expect(code(await people([owner.principalId, outsider.principalId]))).toBe('not_in_chat');
    expect((await people([owner.principalId])).status).toBe(200);
    const rename = await as(w, owner)('PATCH', chatPath(s.company, chat.id), { title: 'Ours' });
    expect([rename.status, (rename.body as ChatView).title]).toEqual([200, 'Ours']);
  });
});

describe("a task's conversation or a team chat", () => {
  it('keeps its own rules: a member still may not write in it, an admin may', async () => {
    const s = await scene(w, { offline: true });
    const t = await tenant(w.t.db, s.company.companyId);
    const owner = s.company.owner.principalId;
    const [flow] = await t
      .insert(flows, { leadPrincipalId: owner, name: 'Delivery', createdBy: owner })
      .returning();
    const fields = {
      agentId: s.agentId,
      machineId: s.machineId,
      createdBy: owner,
      updatedAt: new Date(TEST_NOW),
    };
    const team = await chatRowOf(w, s.company, { ...fields, flowId: (flow as { id: string }).id });
    const member = await addMember(w, s.company, 'member');
    const admin = await addMember(w, s.company, 'admin');
    const send = (person: Person) =>
      as(w, person)('POST', chatPath(s.company, team, '/turns'), { prompt: 'hi' });
    expect([(await send(member)).status, code(await send(member))]).toEqual([403, 'forbidden']);
    expect(code(await send(admin))).toBe('machine_offline');
    expect((await as(w, member)('GET', chatPath(s.company, team))).status).toBe(200);
  });
});

describe("an agent's lists", () => {
  it("hold each person's own chats, and an owner's look at the others", async () => {
    const s = await scene(w, { offline: true });
    const { admin, outsider, chat } = await theirChat(s);
    const ids = async (person: Person, rest = '') => {
      const res = await as(w, person)('GET', `${agentChatsPath(s.company, s.agentId)}${rest}`);
      return [res.status, ((res.body as { chats?: ChatListItemView[] }).chats ?? []).map((c) => c.id)];
    };
    expect(await ids(s.company.owner)).toEqual([200, [s.chat.id]]);
    expect(await ids(admin)).toEqual([200, [chat.id]]);
    expect(await ids(outsider)).toEqual([200, []]);
    expect(await ids(s.company.owner, '/others')).toEqual([200, [chat.id]]);
    expect(await ids(admin, '/others')).toEqual([403, []]);
    const res = await as(w, s.company.owner)('GET', `${agentChatsPath(s.company, s.agentId)}/others`);
    const [other] = (res.body as { chats: ChatListItemView[] }).chats;
    expect(other?.people.map((p) => p.principalId)).toEqual([admin.principalId]);
    const missing = await as(w, s.company.owner)('GET', `${agentChatsPath(s.company, 'nope')}/others`);
    expect(code(missing)).toBe('agent_not_found');
  });
});
