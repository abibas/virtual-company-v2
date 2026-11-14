import { contacts, decisions } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DecisionList } from '../../../src/modules/decisions/schemas.ts';
import { type ChatsWorld, chatsWorld, turnRow } from '../../fixtures/chats/world.ts';
import { decisionsPath } from '../../fixtures/decisions/decisions.ts';
import { as } from '../../fixtures/members/members.ts';
import { agentOf, type RunScene } from '../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../fixtures/tasks.ts';
import { leadTurn, toolCall, toolScene } from '../../fixtures/tools.ts';

/**
 * `GET /api/companies/{companyId}/decisions` (2026-11-14): the decisions the company's agents recorded, newest first,
 * by agent, chat, task, contact and outcome, a page at a time; members and above, the company's own only.
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

/** An id no row has. */
const UNKNOWN = '019a4f0c-c3d4-7e5f-8061-7b8c9d0e1f20';
const later = (minutes: number) => w.clock.set(new Date(Date.parse(TEST_NOW) + minutes * 60_000));

interface Seeded {
  readonly s: RunScene;
  readonly taskId: string;
  readonly developerId: string;
  readonly leadChatId: string;
  readonly contactId: string;
}

/**
 * The Developer records two decisions in its task's step (approved, then declined), the Lead one in its own chat
 * (deferred), and a Slack chat's decision names a contact (written straight in the table, its contact too).
 */
async function seeded(): Promise<Seeded> {
  const s = await toolScene(w, { caps: { decisions: true } });
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  const develop = await s.runner.frames.next('turn.start');
  const record = async (turnId: string, what: string, outcome: string, minutes: number) => {
    later(minutes);
    const result = await toolCall(s.runner, turnId, 'record_decision', {
      what,
      why: `Because ${what}.`,
      outcome,
    });
    if (!result.ok) throw new Error(result.text);
  };
  await record(develop.turnId, 'Use the old API', 'approved', 1);
  await record(develop.turnId, 'Skip the migration', 'declined', 2);
  const lead = await leadTurn(w, s);
  await record(lead.start.turnId, 'Wait for QA', 'deferred', 3);
  const developer = await agentOf(w.t.db, s.c.developer);
  const turn = await turnRow(w.t.db, develop.turnId);
  later(4);
  const [contact] = await rawDb(w.t.db)
    .insert(contacts)
    .values({
      companyId: s.c.companyId,
      source: 'slack',
      name: 'Erich Stuntebeck',
      slackTeamId: 'T0AIRIA',
      slackUserId: 'U0ERICH',
      firstSeenAt: w.clock(),
      lastSeenAt: w.clock(),
    })
    .returning();
  await rawDb(w.t.db)
    .insert(decisions)
    .values({
      companyId: s.c.companyId,
      agentId: developer.id,
      chatId: turn?.chatId as string,
      turnId: develop.turnId,
      contactId: contact?.id as string,
      what: 'Answer the customer',
      why: 'They asked twice.',
      createdAt: w.clock(),
    });
  return {
    s,
    taskId: task.id,
    developerId: developer.id,
    leadChatId: lead.chatId,
    contactId: contact?.id as string,
  };
}

let scene: Seeded;
beforeAll(async () => {
  scene = await seeded();
  await w.disconnectAll();
});

const list = async (query = '', person = scene.s.c.owner) => {
  const res = await as(w, person)('GET', decisionsPath(scene.s.c, query));
  return { status: res.status, body: res.body as DecisionList };
};
const whats = (body: DecisionList) => body.decisions.map((d) => d.what);

describe('GET decisions', () => {
  it('lists the company’s decisions newest first, each with its links', async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(whats(body)).toEqual([
      'Answer the customer',
      'Wait for QA',
      'Skip the migration',
      'Use the old API',
    ]);
    expect(body.nextBefore).toBeNull();
    expect(body.decisions[3]).toMatchObject({
      agentId: scene.developerId,
      taskId: scene.taskId,
      contactId: null,
      why: 'Because Use the old API.',
      sources: [],
      outcome: 'approved',
      eventSeq: 0,
      createdAt: new Date(Date.parse(TEST_NOW) + 60_000).toISOString(),
    });
  });

  it('filters by agent, chat, task, contact and outcome', async () => {
    const agent = await list(`?agent=${scene.developerId}`);
    expect(whats(agent.body)).toEqual(['Answer the customer', 'Skip the migration', 'Use the old API']);
    expect(whats((await list(`?chat=${scene.leadChatId}`)).body)).toEqual(['Wait for QA']);
    expect(whats((await list(`?task=${scene.taskId}`)).body)).toEqual([
      'Skip the migration',
      'Use the old API',
    ]);
    expect(whats((await list(`?contact=${scene.contactId}`)).body)).toEqual(['Answer the customer']);
    expect(whats((await list(`?contact=${UNKNOWN}`)).body)).toEqual([]);
    expect(whats((await list('?outcome=declined')).body)).toEqual(['Skip the migration']);
    expect(whats((await list(`?agent=${scene.developerId}&outcome=deferred`)).body)).toEqual([]);
  });

  it('pages with limit and before', async () => {
    const first = await list('?limit=3');
    expect(whats(first.body)).toEqual(['Answer the customer', 'Wait for QA', 'Skip the migration']);
    expect(first.body.nextBefore).toBe(first.body.decisions[2]?.id);
    const next = await list(`?limit=3&before=${first.body.nextBefore}`);
    expect(whats(next.body)).toEqual(['Use the old API']);
    expect(next.body.nextBefore).toBeNull();
  });

  it('refuses a filter that is not valid, and a before that names no decision', async () => {
    const bad = await list('?outcome=maybe');
    expect([bad.status, (bad.body as unknown as { error: { code: string } }).error.code]).toEqual([
      400,
      'invalid_request',
    ]);
    expect((await list('?agent=not-an-id')).status).toBe(400);
    const unknown = await list(`?before=${UNKNOWN}`);
    expect([unknown.status, (unknown.body as unknown as { error: { code: string } }).error.code]).toEqual([
      400,
      'unknown_before',
    ]);
  });

  it('is for members and above of the company: a viewer is refused, another company sees none of them', async () => {
    expect((await list('', scene.s.c.member)).status).toBe(200);
    expect((await list('', scene.s.c.viewer)).status).toBe(403);
    const other = await toolScene(w);
    expect((await as(w, other.c.owner)('GET', decisionsPath(scene.s.c))).status).toBe(404);
    const theirs = await as(w, other.c.owner)('GET', decisionsPath(other.c));
    expect([theirs.status, (theirs.body as DecisionList).decisions]).toEqual([200, []]);
  });
});
