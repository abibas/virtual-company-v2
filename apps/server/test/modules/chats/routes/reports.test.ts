import { agents, chatEvents, flows, tenant } from '@mwc/db';
import { seedAgent } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chatRowOf, reportChatsOf, reportChatsPath, turnRowOf } from '../../../fixtures/chats/reports.ts';
import { agentIdOf, machineOf, questionEvent } from '../../../fixtures/inbox.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';
import { makeFlow, makeTask, stepOf, type TeamCompany, teamCompany } from '../../../fixtures/tasks.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 9, minute));
const iso = (minute: number) => at(minute).toISOString();

/**
 * `GET /api/companies/:companyId/me/report-chats` (docs/harness.md "Your direct reports in the rail"): the agents that
 * report to the viewer, the Leads first, each with its main chat with the viewer and where it stands.
 */
describe('GET /api/companies/:companyId/me/report-chats', () => {
  let c: TeamCompany;
  let machineId: string;
  beforeEach(async () => {
    c = await teamCompany(w);
    machineId = await machineOf(w, c);
  });

  /** An agent placed under the owner. */
  const underOwner = async (name: string) =>
    (
      await seedAgent(w.t.db, c.companyId, {
        name,
        slug: name.toLowerCase(),
        roleTitle: `${name} role`,
        reportsTo: c.owner.principalId,
      })
    ).agent;

  const chat = (agentId: string, minute: number, fields: Record<string, unknown> = {}) =>
    chatRowOf(w, c, { agentId, machineId, createdBy: c.owner.principalId, updatedAt: at(minute), ...fields });

  it('lists the agents that report to the viewer, the Leads first and then by name; never people', async () => {
    const zed = await underOwner('Zed');
    const alpha = await underOwner('alpha');
    // The owner's people (admin, member, viewer, tester, manager) report to them too, and are left out.
    expect((await reportChatsOf(w, c.owner, c)).map((r) => r.agent.name)).toEqual(['alpha', 'Zed']);
    // The manager's one report, the DEVBOX Coordinator, leads a flow once there is one.
    await makeFlow(w, c);
    const [lead, ...rest] = await reportChatsOf(w, c.manager, c);
    expect(rest).toEqual([]);
    expect(lead).toEqual({
      agent: {
        id: await agentIdOf(w.t.db, c.lead),
        principalId: c.lead,
        name: 'DEVBOX Coordinator',
        slug: 'devbox-coordinator',
        roleTitle: 'DEVBOX Coordinator',
        status: 'active',
      },
      team: { flowId: expect.any(String), name: 'DEVBOX delivery', chatId: null },
      chat: null,
      lastTurn: null,
      working: false,
      question: false,
      replyAt: null,
      messageAt: null,
    });
    // A Lead goes first; a paused agent stays, an archived one goes.
    const t = await tenant(w.t.db, c.companyId);
    await t.update(agents, { status: 'paused' }, eq(agents.id, zed.id));
    await t.update(agents, { status: 'archived' }, eq(agents.id, alpha.id));
    const leadUnderOwner = await seedAgent(w.t.db, c.companyId, {
      name: 'Owner Lead',
      slug: 'owner-lead',
      reportsTo: c.owner.principalId,
    });
    await t.insert(flows, {
      leadPrincipalId: leadUnderOwner.principal.id,
      name: 'Owner team',
      createdBy: c.owner.principalId,
    });
    const mine = await reportChatsOf(w, c.owner, c);
    expect(mine.map((r) => [r.agent.name, r.agent.status, r.team?.name ?? null])).toEqual([
      ['Owner Lead', 'active', 'Owner team'],
      ['Zed', 'paused', null],
    ]);
  });

  it("chooses the main chat: the viewer's latest, neither another person's, a task's, a team chat nor archived", async () => {
    const agent = await underOwner('Writer');
    const flow = await makeFlow(w, c);
    const task = await makeTask(w, c, c.manager, { flowId: flow.id });
    const main = await chat(agent.id, 1, { title: 'The main one' });
    await chat(agent.id, 0, { title: 'An older one' });
    await chat(agent.id, 2, { archivedAt: at(3) });
    await chat(agent.id, 4, { createdBy: c.admin.principalId });
    await chat(agent.id, 5, { task: { id: task.id, stepId: stepOf(flow, 'Develop').id } });
    await chat(agent.id, 6, { flowId: flow.id });
    const [report] = await reportChatsOf(w, c.owner, c);
    expect(report?.chat).toEqual({ id: main, title: 'The main one', updatedAt: iso(1) });
    // The admin's own main chat with the same agent is theirs, though the agent does not report to them.
    expect(await reportChatsOf(w, c.admin, c)).toEqual([]);
  });

  it('says where the main chat stands: its last turn, a running one, its latest reply and your latest message', async () => {
    const agent = await underOwner('Writer');
    const id = await chat(agent.id, 0);
    const owner = c.owner.principalId;
    await turnRowOf(w, c, id, { seq: 1, createdBy: owner, at: at(1) });
    await turnRowOf(w, c, id, { seq: 2, createdBy: owner, at: at(3), kind: 'compact' });
    await turnRowOf(w, c, id, { seq: 3, createdBy: owner, at: at(5), status: 'failed' });
    expect((await reportChatsOf(w, c.owner, c))[0]).toMatchObject({
      lastTurn: { status: 'failed', at: iso(6) },
      working: false,
      question: false,
      replyAt: iso(2),
      messageAt: iso(5),
    });
    await turnRowOf(w, c, id, { seq: 4, createdBy: owner, at: at(7), status: 'running' });
    await turnRowOf(w, c, id, { seq: 5, createdBy: owner, at: at(8), status: 'queued' });
    expect((await reportChatsOf(w, c.owner, c))[0]).toMatchObject({
      lastTurn: { status: 'queued', at: iso(8) },
      working: true,
      replyAt: iso(2),
      messageAt: iso(8),
    });
  });

  it('counts only the viewer’s own messages, not one Most Wanted queued or another person’s', async () => {
    const agent = await underOwner('Writer');
    const id = await chat(agent.id, 0);
    await turnRowOf(w, c, id, { seq: 1, createdBy: c.owner.principalId, at: at(1) });
    await turnRowOf(w, c, id, { seq: 2, createdBy: c.admin.principalId, at: at(3) });
    await turnRowOf(w, c, id, { seq: 3, createdBy: c.owner.principalId, at: at(5), system: true });
    expect((await reportChatsOf(w, c.owner, c))[0]).toMatchObject({ replyAt: iso(6), messageAt: iso(1) });
  });

  it('says a question is open while the last turn asks and nothing answered it', async () => {
    const agent = await underOwner('Writer');
    const id = await chat(agent.id, 0);
    const turnId = await turnRowOf(w, c, id, { seq: 1, createdBy: c.owner.principalId, at: at(1) });
    const question = questionEvent() as { id: string };
    const t = await tenant(w.t.db, c.companyId);
    await t.insert(chatEvents, { turnId, seq: 1, event: question, at: at(2) });
    expect((await reportChatsOf(w, c.owner, c))[0]?.question).toBe(true);
    await t.insert(chatEvents, {
      turnId,
      seq: 2,
      event: { type: 'answered', questionId: question.id, answers: [] },
      at: at(3),
    });
    expect((await reportChatsOf(w, c.owner, c))[0]?.question).toBe(false);
  });

  it("names a Lead's flow with its latest team chat with it", async () => {
    const first = await makeFlow(w, c);
    const leadAgent = await agentIdOf(w.t.db, c.lead);
    const team = (minute: number, fields: Record<string, unknown> = {}) =>
      chatRowOf(w, c, {
        agentId: leadAgent,
        machineId,
        createdBy: c.lead,
        updatedAt: at(minute),
        flowId: first.id,
        ...fields,
      });
    await team(0);
    const latest = await team(1);
    await team(2, { archivedAt: at(3) });
    // Another agent's chat naming the flow is not the Lead's team chat.
    await team(4, { agentId: await agentIdOf(w.t.db, c.developer), createdBy: c.developer });
    const [lead] = await reportChatsOf(w, c.manager, c);
    expect(lead?.team).toEqual({ flowId: first.id, name: 'DEVBOX delivery', chatId: latest });
    expect(lead?.chat).toBeNull();
  });

  it('is for members and above of this company only', async () => {
    expect((await as(w, c.viewer)('GET', reportChatsPath(c))).status).toBe(403);
    expect((await reportChatsOf(w, c.member, c)).length).toBe(0);
    const other = await membersCompany(w);
    expect((await as(w, other.owner)('GET', reportChatsPath(c))).status).toBe(404);
    // Another company's agents never show, even under a principal of the same id shape.
    await underOwner('Writer');
    expect(await reportChatsOf(w, other.owner, other)).toEqual([]);
  });
});
