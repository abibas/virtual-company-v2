import { flows, tenant } from '@mwc/db';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChatListItemView } from '../../../../src/modules/chats/schemas/activity.ts';
import type { ChatPersonView } from '../../../../src/modules/chats/schemas/people.ts';
import type { ChatDetailView } from '../../../../src/modules/chats/schemas.ts';
import { chatRowOf } from '../../../fixtures/chats/reports.ts';
import {
  agentChatsPath,
  beginChat,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  type Scene,
  scene,
} from '../../../fixtures/chats/world.ts';
import { auditOf } from '../../../fixtures/machines/machines.ts';
import { addMember, as } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"): a new chat has its creator and the members it is
 * with; anyone in it adds members, the creator and owners take someone out, anyone leaves; each change is audited and
 * shows as a quiet line in the thread; a task's conversation and a team chat have no people of their own.
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

const peoplePath = (s: Scene, chatId: string, rest = '') => chatPath(s.company, chatId, `/people${rest}`);
const add = (s: Scene, chatId: string, by: Person, people: readonly Person[]) =>
  as(w, by)('POST', peoplePath(s, chatId), { principalIds: people.map((p) => p.principalId) });
const detail = async (s: Scene, chatId: string, by: Person = s.company.owner) =>
  (await as(w, by)('GET', chatPath(s.company, chatId))).body as ChatDetailView;
const names = (people: readonly ChatPersonView[]) => people.map((p) => p.name);
const error = (res: { status: number; body: unknown }) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];
/** The chat's audit rows after its creation. */
const changesOf = async (chatId: string) =>
  (await auditOf(w.t.db, 'chat', chatId)).filter((row) => !row.startsWith('create '));
const lines = (chat: ChatDetailView) =>
  chat.turns.filter((turn) => turn.kind === 'people').map((turn) => turn.prompt);

describe('a new chat', () => {
  it('has its creator and the members it is with, listed for each of them with their faces', async () => {
    const s = await scene(w, { offline: true });
    const anna = await addMember(w, s.company, 'admin');
    const bob = await addMember(w, s.company, 'member');
    const chat = await beginChat(w, s.company, s.agentId, {
      with: [anna.principalId, bob.principalId, s.company.owner.principalId],
    });
    const shown = await detail(s, chat.id);
    expect(shown.people).toEqual([
      expect.objectContaining({ principalId: s.company.owner.principalId, kind: 'member', creator: true }),
      expect.objectContaining({
        principalId: anna.principalId,
        name: anna.subject,
        addedBy: s.company.owner.principalId,
      }),
      expect.objectContaining({ principalId: bob.principalId, name: bob.subject, creator: false }),
    ]);
    expect([shown.ownerView, shown.slack]).toEqual([false, null]);
    const list = await as(w, bob)('GET', agentChatsPath(s.company, s.agentId));
    const [item] = (list.body as { chats: ChatListItemView[] }).chats;
    expect([item?.id, names(item?.people ?? []), item?.lastTurn]).toEqual([
      chat.id,
      [expect.stringMatching(/^Owner /), anna.subject, bob.subject],
      null,
    ]);
    expect(await auditOf(w.t.db, 'chat', chat.id)).toContain('create people');
  });

  it('refuses someone who is no active member above a viewer', async () => {
    const s = await scene(w, { offline: true });
    const viewer = await addMember(w, s.company, 'viewer');
    const gone = await addMember(w, s.company, 'member', 'removed');
    for (const id of [viewer.principalId, gone.principalId, 'nope', s.agentId]) {
      const res = await as(w, s.company.owner)('POST', agentChatsPath(s.company, s.agentId), { with: [id] });
      expect(error(res)).toEqual([422, 'person_not_member']);
    }
  });
});

describe('POST chats/:chatId/people', () => {
  it('lets anyone in the chat add members, each audited with a line in the thread, and tells the newcomer', async () => {
    const s = await scene(w, { offline: true });
    const anna = await addMember(w, s.company, 'member');
    const bob = await addMember(w, s.company, 'admin');
    expect(error(await add(s, s.chat.id, anna, [anna]))).toEqual([404, 'chat_not_found']);
    const res = await add(s, s.chat.id, s.company.owner, [anna, anna]);
    expect(names((res.body as { people: ChatPersonView[] }).people)).toEqual([
      expect.stringMatching(/^Owner /),
      anna.subject,
    ]);
    expect((await add(s, s.chat.id, anna, [bob])).status).toBe(200);
    const shown = await detail(s, s.chat.id, bob);
    expect(lines(shown)).toEqual([
      expect.stringMatching(new RegExp(`^Owner \\S+ added ${anna.subject}$`)),
      `${anna.subject} added ${bob.subject}`,
    ]);
    expect(shown.turns.map((turn) => [turn.kind, turn.status, turn.credentialId])).toEqual([
      ['people', 'done', null],
      ['people', 'done', null],
    ]);
    expect(error(await add(s, s.chat.id, anna, [bob]))).toEqual([409, 'person_in_chat']);
    const viewer = await addMember(w, s.company, 'viewer');
    expect(error(await add(s, s.chat.id, anna, [viewer]))).toEqual([422, 'person_not_member']);
    expect(await changesOf(s.chat.id)).toEqual(['add_person person', 'add_person person']);
    // The title stays the chat's own: no line becomes it.
    expect(shown.title).toBeNull();
  });

  it("refuses an archived chat, a task's conversation and a team chat", async () => {
    const s = await scene(w, { offline: true });
    const anna = await addMember(w, s.company, 'member');
    const t = await tenant(w.t.db, s.company.companyId);
    const [flow] = await t
      .insert(flows, {
        leadPrincipalId: s.company.owner.principalId,
        name: 'Delivery',
        createdBy: s.company.owner.principalId,
      })
      .returning();
    const team = await chatRowOf(w, s.company, {
      agentId: s.agentId,
      machineId: s.machineId,
      createdBy: s.company.owner.principalId,
      updatedAt: new Date(TEST_NOW),
      flowId: (flow as { id: string }).id,
    });
    expect(error(await add(s, team, s.company.owner, [anna]))).toEqual([409, 'people_unsupported']);
    expect((await detail(s, team)).people).toEqual([]);
    await as(w, s.company.owner)('DELETE', chatPath(s.company, s.chat.id));
    expect(error(await add(s, s.chat.id, s.company.owner, [anna]))).toEqual([409, 'chat_archived']);
    expect(error(await add(s, 'nope', s.company.owner, [anna]))).toEqual([404, 'chat_not_found']);
  });
});

describe('DELETE chats/:chatId/people/:personId', () => {
  /** A chat the admin began with Anna and Bob. */
  async function group(s: Scene) {
    const admin = await addMember(w, s.company, 'admin');
    const anna = await addMember(w, s.company, 'member');
    const bob = await addMember(w, s.company, 'member');
    const chat = await beginChat(
      w,
      s.company,
      s.agentId,
      { with: [anna.principalId, bob.principalId] },
      admin,
    );
    const people = (await detail(s, chat.id, admin)).people;
    const idOf = (person: Person) => people.find((p) => p.principalId === person.principalId)?.id as string;
    return { admin, anna, bob, chat, idOf };
  }

  const remove = (s: Scene, chatId: string, by: Person, personId: string) =>
    as(w, by)('DELETE', peoplePath(s, chatId, `/${personId}`));

  it("lets the chat's creator take someone out and anyone leave, audited, each with its line", async () => {
    const s = await scene(w, { offline: true });
    const g = await group(s);
    expect(error(await remove(s, g.chat.id, g.anna, g.idOf(g.bob)))).toEqual([403, 'remove_refused']);
    expect((await remove(s, g.chat.id, g.admin, g.idOf(g.bob))).status).toBe(200);
    const left = await remove(s, g.chat.id, g.anna, g.idOf(g.anna));
    expect(names((left.body as { people: ChatPersonView[] }).people)).toEqual([g.admin.subject]);
    expect(lines(await detail(s, g.chat.id, g.admin))).toEqual([
      `${g.admin.subject} removed ${g.bob.subject}`,
      `${g.anna.subject} left the chat`,
    ]);
    expect((await as(w, g.anna)('GET', chatPath(s.company, g.chat.id))).status).toBe(404);
    expect(error(await remove(s, g.chat.id, g.admin, g.idOf(g.anna)))).toEqual([404, 'person_not_found']);
    expect(await changesOf(g.chat.id)).toEqual(['remove_person person', 'leave person']);
    expect(await auditOf(w.t.db, 'chat', g.chat.id)).toContain('create people');
  });

  it('lets a company owner take someone out once they are in the chat', async () => {
    const s = await scene(w, { offline: true });
    const g = await group(s);
    const owner = s.company.owner;
    expect(error(await remove(s, g.chat.id, owner, g.idOf(g.bob)))).toEqual([403, 'not_in_chat']);
    expect((await add(s, g.chat.id, owner, [owner])).status).toBe(200);
    expect((await remove(s, g.chat.id, owner, g.idOf(g.bob))).status).toBe(200);
    expect(lines(await detail(s, g.chat.id))).toEqual([
      expect.stringMatching(/^Owner \S+ joined the chat$/),
      expect.stringMatching(new RegExp(`^Owner \\S+ removed ${g.bob.subject}$`)),
    ]);
  });
});
