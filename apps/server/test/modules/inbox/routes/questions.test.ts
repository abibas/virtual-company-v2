import { agents, chatEvents, chats, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  chatOf,
  DATABASE,
  inboxOf,
  machineOf,
  PARTS,
  questionEvent,
  turnOf,
} from '../../../fixtures/inbox.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { makeFlow, makeTask, moved, stepOf, type TeamCompany, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/**
 * An agent's question (docs/harness.md "Asking the person"): open while it is the latest question of its chat's last
 * turn and nothing answered it; shown to those who may answer it (admins and owners).
 */
describe('GET /api/companies/:companyId/inbox: questions', () => {
  let c: TeamCompany;
  let machineId: string;
  beforeEach(async () => {
    c = await teamCompany(w);
    machineId = await machineOf(w, c);
  });

  const asking = async (options: { title?: string | null } = {}) => {
    const chat = await chatOf(w, c, { agentPrincipalId: c.developer, machineId, ...options });
    const question = questionEvent();
    const turnId = await turnOf(w, c, chat.chatId, 1, [
      { type: 'text', text: 'Two choices first.' },
      question,
      { type: 'result', ok: true, text: 'Two choices first.' },
    ]);
    return { ...chat, turnId, questionId: (question as { id: string }).id };
  };

  it('shows an open question to the admins and owners, linking to its chat, and to nobody else', async () => {
    const asked = await asking();
    for (const person of [c.owner, c.admin]) {
      const { items } = await inboxOf(w, person, c);
      expect(items).toEqual([
        {
          id: `question:${asked.questionId}`,
          kind: 'question',
          company: expect.objectContaining({ id: c.companyId }),
          title: DATABASE.question,
          subtitle: 'Developer · Set up the service',
          reason: null,
          from: { principalId: c.developer, kind: 'agent', name: 'Developer', slug: 'developer' },
          link: `chats/${asked.agentId}?chat=${asked.chatId}`,
          actions: ['answer'],
          task: null,
          question: {
            chatId: asked.chatId,
            agentId: asked.agentId,
            questionId: asked.questionId,
            count: 2,
            chatTitle: 'Set up the service',
            taskKey: null,
          },
          at: expect.any(String),
        },
      ]);
    }
    for (const person of [c.manager, c.member, c.viewer, c.tester]) {
      expect((await inboxOf(w, person, c)).items).toEqual([]);
    }
  });

  it('drops a question once answered, once a newer turn supersedes it, or once its chat is archived', async () => {
    const answered = await asking();
    await turnOf(w, c, answered.chatId, 2, []);
    expect((await inboxOf(w, c.owner, c)).items).toEqual([]);

    const marked = await asking({ title: null });
    expect((await inboxOf(w, c.owner, c)).items.map((item) => item.subtitle)).toEqual(['Developer']);
    // The answer mark lands in the asking turn, as the answers route writes it.
    const t = await tenant(w.t.db, c.companyId);
    await t.insert(chatEvents, {
      turnId: marked.turnId,
      seq: 4,
      event: {
        type: 'answered',
        questionId: marked.questionId,
        turnId: newId(),
        answers: [{ question: DATABASE.question, picked: ['SQLite'] }],
      },
    });
    expect((await inboxOf(w, c.owner, c)).items).toEqual([]);

    const archived = await asking();
    await rawDb(w.t.db).update(chats).set({ archivedAt: new Date() }).where(eq(chats.id, archived.chatId));
    expect((await inboxOf(w, c.owner, c)).items).toEqual([]);

    // An archived agent's chats ask nobody.
    const gone = await chatOf(w, c, { agentPrincipalId: c.qaBot, machineId });
    await turnOf(w, c, gone.chatId, 1, [questionEvent()]);
    expect((await inboxOf(w, c.owner, c)).items.map((item) => item.subtitle)).toEqual([
      'QA bot · Set up the service',
    ]);
    await rawDb(w.t.db).update(agents).set({ status: 'archived' }).where(eq(agents.id, gone.agentId));
    expect((await inboxOf(w, c.owner, c)).items).toEqual([]);
  });

  it('sits after a Sign-off and before the stuck tasks', async () => {
    const flow = await makeFlow(w, c);
    const signoff = await makeTask(w, c, c.manager, { flowId: flow.id, stepId: stepOf(flow, 'Approve').id });
    const blocked = await makeTask(w, c, c.manager, { flowId: flow.id, stepId: stepOf(flow, 'Develop').id });
    await moved(w, c, c.manager, blocked.key, { action: 'start' });
    await asking();
    const kinds = (await inboxOf(w, c.owner, c)).items.map((item) => [item.kind, item.task?.key ?? null]);
    expect(kinds).toEqual([
      ['signoff', signoff.key],
      ['question', null],
      ['blocked', blocked.key],
    ]);
  });

  it("keeps only a turn's latest question, and names the task whose conversation asks", async () => {
    const flow = await makeFlow(w, c);
    const develop = stepOf(flow, 'Develop');
    const task = await makeTask(w, c, c.manager, { flowId: flow.id, stepId: develop.id });
    const chat = await chatOf(w, c, {
      agentPrincipalId: c.developer,
      machineId,
      title: `${task.key} · Develop · Fix the login`,
      task: { id: task.id, stepId: develop.id },
    });
    const later = questionEvent([PARTS]);
    await turnOf(w, c, chat.chatId, 1, [questionEvent(), later]);
    const [item, ...rest] = (await inboxOf(w, c.owner, c)).items;
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      kind: 'question',
      title: PARTS.question,
      subtitle: `Developer · ${task.key} · Develop · Fix the login`,
      question: { count: 1, taskKey: task.key, questionId: (later as { id: string }).id },
    });
  });
});
