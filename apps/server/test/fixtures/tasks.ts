/**
 * The tasks tests' helpers (S5.3a): a company with a team on its chart (a member who manages the Lead agent, the Lead
 * with three agents under it, and people around it), its flow made through the API, tasks made and moved as one of
 * them, and raw reads of a task's history and notifications.
 */
import { type DbHandle, notifications, taskEvents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { seedAgent } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import type { FlowView } from '../../src/modules/tasks/schemas/flows.ts';
import type { TaskDetailView } from '../../src/modules/tasks/schemas/tasks.ts';
import { as, type MembersCompany, membersCompany } from './members/members.ts';
import { placedMember } from './org.ts';
import type { AuthWorld, Person } from './platform/auth.ts';

export type { FlowView, TaskDetailView };

/**
 * Acme's team: the owner at the top; under the owner an admin, a member outside the team, a viewer, a tester (a member
 * who does a step) and the manager (a member) with the Lead agent "DEVBOX Coordinator" under them; under the Lead the
 * agents Developer, Code Reviewer and QA bot. The Lead's people are the manager and the owner.
 */
export interface TeamCompany extends MembersCompany {
  readonly admin: Person;
  readonly member: Person;
  readonly viewer: Person;
  readonly tester: Person;
  readonly manager: Person;
  readonly lead: string;
  readonly leadSlug: string;
  readonly developer: string;
  readonly reviewer: string;
  readonly qaBot: string;
}

export async function teamCompany(w: AuthWorld): Promise<TeamCompany> {
  const company = await membersCompany(w);
  const admin = await placedMember(w, company, 'admin');
  const member = await placedMember(w, company, 'member');
  const viewer = await placedMember(w, company, 'viewer');
  const tester = await placedMember(w, company, 'member');
  const manager = await placedMember(w, company, 'member');
  const agent = (name: string, slug: string, reportsTo: string) =>
    seedAgent(w.t.db, company.companyId, { name, slug, roleTitle: name, reportsTo });
  const lead = await agent('DEVBOX Coordinator', 'devbox-coordinator', manager.principalId);
  const under = (name: string, slug: string) => agent(name, slug, lead.principal.id);
  return {
    ...company,
    admin,
    member,
    viewer,
    tester,
    manager,
    lead: lead.principal.id,
    leadSlug: lead.agent.slug,
    developer: (await under('Developer', 'developer')).principal.id,
    reviewer: (await under('Code Reviewer', 'code-reviewer')).principal.id,
    qaBot: (await under('QA bot', 'qa-bot')).principal.id,
  };
}

export const flowsPath = (company: Pick<MembersCompany, 'companyId'>, rest = '') =>
  `/api/companies/${company.companyId}/flows${rest}`;
export const tasksPath = (company: Pick<MembersCompany, 'companyId'>, rest = '') =>
  `/api/companies/${company.companyId}/tasks${rest}`;
export const leadFlowPath = (company: Pick<MembersCompany, 'companyId'>, lead: string) =>
  `/api/companies/${company.companyId}/leads/${lead}/flow`;

/** The DEVBOX-like steps (docs/processes.md): Develop, Code review (3), QA by the tester (2), Approve by the owner. */
export const devboxSteps = (c: TeamCompany) => [
  { name: 'Develop', kind: 'work', assigneePrincipalId: c.developer },
  {
    name: 'Code review',
    kind: 'check',
    assigneePrincipalId: c.reviewer,
    sendsBackTo: 'Develop',
    sendBackLimit: 3,
  },
  {
    name: 'QA',
    kind: 'check',
    assigneePrincipalId: c.tester.principalId,
    onReturn: 'fresh',
    sendsBackTo: 'Develop',
    sendBackLimit: 2,
  },
  { name: 'Approve', kind: 'signoff', assigneePrincipalId: c.owner.principalId, sendsBackTo: 'Develop' },
];

/** Makes the team's flow through the API as `by` (the owner unless said); the test fails on anything but a 201. */
export async function makeFlow(
  w: AuthWorld,
  c: TeamCompany,
  options: { readonly by?: Person; readonly steps?: unknown[]; readonly name?: string } = {},
): Promise<FlowView> {
  const body = {
    leadPrincipalId: c.lead,
    name: options.name ?? 'DEVBOX delivery',
    steps: options.steps ?? devboxSteps(c),
  };
  const res = await as(w, options.by ?? c.owner)('POST', flowsPath(c), body);
  if (res.status !== 201) throw new Error(`POST flows answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as FlowView;
}

/** A step of the flow by name. */
export const stepOf = (flow: FlowView, name: string) => {
  const step = flow.steps.find((s) => s.name === name);
  if (step === undefined) throw new Error(`no step ${name}`);
  return step;
};

/** Makes a task through the API as `by`; the test fails on anything but a 201. */
export async function makeTask(
  w: AuthWorld,
  c: TeamCompany,
  by: Person,
  body: Record<string, unknown>,
): Promise<TaskDetailView> {
  const res = await as(w, by)('POST', tasksPath(c), { title: 'Fix the login', ...body });
  if (res.status !== 201) throw new Error(`POST tasks answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as TaskDetailView;
}

/** One move as `by`: the response as the API answers it. */
export const act = (w: AuthWorld, c: TeamCompany, by: Person, key: string, body: Record<string, unknown>) =>
  as(w, by)('POST', tasksPath(c, `/${key}/actions`), body);

/** One move as `by` that must succeed: the task after it. */
export async function moved(
  w: AuthWorld,
  c: TeamCompany,
  by: Person,
  key: string,
  body: Record<string, unknown>,
): Promise<{ outcome: string; task: TaskDetailView }> {
  const res = await act(w, c, by, key, body);
  if (res.status !== 200)
    throw new Error(`${body.action} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as { outcome: string; task: TaskDetailView };
}

/** A task's history as stored, oldest first: `[kind, from, to, round]` with the steps' names. */
export async function historyOf(db: DbHandle, taskId: string) {
  const rows = await rawDb(db)
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(asc(taskEvents.id));
  return rows.map((row) => [row.kind, row.fromStepName, row.toStepName, row.round] as const);
}

/** A company's task notifications, oldest first, as `[recipient, kind]`. */
export async function taskNotices(db: DbHandle, companyId: string) {
  const rows = await rawDb(db)
    .select()
    .from(notifications)
    .where(and(eq(notifications.companyId, companyId)))
    .orderBy(asc(notifications.id));
  return rows
    .filter((row) => row.kind.startsWith('task_'))
    .map((row) => [row.recipientPrincipalId, row.kind] as const);
}
