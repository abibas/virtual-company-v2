/**
 * The inbox tests' helpers (S6b): the inbox read as a person, in one company or across theirs; a company's task moved
 * to the states only a run leaves (a turn that ended without a hand-off); an agent's chat that asks a question, written
 * straight into the company's tenant (a machine enrolled through the API, the chat, its turn and the question event); and
 * a person of one company joining another as the same user.
 */
import {
  agents,
  chatEvents,
  chats,
  chatTurns,
  type DbHandle,
  memberships,
  orgPositions,
  principals,
  taskEvents,
  tasks,
  tenant,
} from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MembershipRole } from '@mwc/shared/enums';
import type { AskQuestion, TurnEvent } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { eq } from 'drizzle-orm';
import type { InboxItem, MyInbox } from '../../src/modules/inbox/schemas.ts';
import { enroll } from './machines/machines.ts';
import { as, type MembersCompany } from './members/members.ts';
import type { AuthWorld, Person } from './platform/auth.ts';

export type { InboxItem, MyInbox };

export const inboxPath = (company: Pick<MembersCompany, 'companyId'>, rest = '') =>
  `/api/companies/${company.companyId}/inbox${rest}`;
export const MY_INBOX = '/api/me/inbox';

/** A person's inbox in a company; the test fails on anything but a 200. */
export async function inboxOf(w: AuthWorld, person: Person, company: Pick<MembersCompany, 'companyId'>) {
  const res = await as(w, person)('GET', inboxPath(company));
  if (res.status !== 200) throw new Error(`GET inbox answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as { items: InboxItem[]; count: number };
}

/** A person's inbox across their companies; the test fails on anything but a 200. */
export async function myInboxOf(w: AuthWorld, person: Person): Promise<MyInbox> {
  const res = await as(w, person)('GET', MY_INBOX);
  if (res.status !== 200)
    throw new Error(`GET /api/me/inbox answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as MyInbox;
}

/** `[kind, key or question, subtitle]` of each item, in order. */
export const shortOf = (items: readonly InboxItem[]) =>
  items.map((item) => [item.kind, item.task?.key ?? item.title, item.subtitle] as const);

/** Sets an active task's step state as a turn's end would (`ended_without_handoff`), with its `turn_ended` row. */
export async function endTurnOf(
  db: DbHandle,
  companyId: string,
  taskId: string,
  reason: string | null = null,
) {
  const t = await tenant(db, companyId);
  const [task] = await t
    .update(tasks, { stepState: 'ended_without_handoff' }, eq(tasks.id, taskId))
    .returning();
  const step = (task as { currentStepId: string }).currentStepId;
  await t.insert(taskEvents, { taskId, kind: 'turn_ended', toStepId: step, reason });
}

/** The id of the agent of a principal. */
export async function agentIdOf(db: DbHandle, principalId: string): Promise<string> {
  const [row] = await rawDb(db)
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.principalId, principalId));
  return (row as { id: string }).id;
}

export const DATABASE: AskQuestion = {
  question: 'Which database should the service use?',
  header: 'Database',
  options: [
    { label: 'PostgreSQL', description: 'The one the other services use' },
    { label: 'SQLite', description: 'A file beside the service' },
  ],
  multiSelect: false,
};

export const PARTS: AskQuestion = {
  question: 'Which parts come first?',
  header: 'Parts',
  options: [
    { label: 'Auth', description: 'Sign-in' },
    { label: 'Billing', description: 'Plans' },
  ],
  multiSelect: true,
};

/** A chat of an agent, as `ask` writes it. */
export interface AskedChat {
  readonly chatId: string;
  readonly agentId: string;
  readonly machineId: string;
}

/** A machine of the company, enrolled through the API (chats name the machine their session lives on). */
export const machineOf = async (w: AuthWorld, company: MembersCompany) =>
  (await enroll(w, company)).machineId;

/**
 * Writes a chat of the agent of `agentPrincipalId` on `machineId`, titled `title` (a task's conversation when `task`
 * names it), with no turn yet.
 */
export async function chatOf(
  w: AuthWorld,
  company: MembersCompany,
  options: {
    readonly agentPrincipalId: string;
    readonly machineId: string;
    readonly title?: string | null;
    readonly task?: { readonly id: string; readonly stepId: string };
  },
): Promise<AskedChat> {
  const t = await tenant(w.t.db, company.companyId);
  const agentId = await agentIdOf(w.t.db, options.agentPrincipalId);
  const task = options.task ? { taskId: options.task.id, taskStepId: options.task.stepId, taskRound: 1 } : {};
  const [row] = await t
    .insert(chats, {
      agentId,
      harness: 'claude_code',
      machineId: options.machineId,
      title: options.title === undefined ? 'Set up the service' : options.title,
      createdBy: company.owner.principalId,
      ...task,
    })
    .returning();
  return { chatId: (row as { id: string }).id, agentId, machineId: options.machineId };
}

/** Writes the chat's next turn (done) with these events; its id. */
export async function turnOf(
  w: AuthWorld,
  company: MembersCompany,
  chatId: string,
  seq: number,
  events: readonly TurnEvent[],
): Promise<string> {
  const t = await tenant(w.t.db, company.companyId);
  const [turn] = await t
    .insert(chatTurns, {
      chatId,
      seq,
      prompt: `Message ${seq}`,
      status: 'done',
      createdBy: company.owner.principalId,
    })
    .returning();
  const turnId = (turn as { id: string }).id;
  if (events.length > 0)
    await t.insert(
      chatEvents,
      events.map((event, n) => ({
        turnId,
        seq: n + 1,
        event: event as Record<string, unknown>,
        at: new Date(),
      })),
    );
  return turnId;
}

/** A turn's `question` event asking `questions`, with a new id. */
export const questionEvent = (questions: AskQuestion[] = [DATABASE, PARTS]): TurnEvent => ({
  type: 'question',
  id: newId(),
  questions,
});

/** The person (a user of another company) joining `company` as `role`, placed under `reportsTo`; their principal here. */
export async function joinAs(
  db: DbHandle,
  company: Pick<MembersCompany, 'companyId'>,
  person: Person,
  role: MembershipRole,
  reportsTo: string,
): Promise<Person> {
  const t = await tenant(db, company.companyId);
  const [principal] = await t.insert(principals, { kind: 'person' }).returning();
  const principalId = (principal as { id: string }).id;
  const [membership] = await t
    .insert(memberships, { principalId, userId: person.userId, role, grantedRole: role, status: 'active' })
    .returning();
  await t.insert(orgPositions, { principalId, reportsToPrincipalId: reportsTo, title: null });
  return { ...person, principalId, membershipId: (membership as { id: string }).id };
}
