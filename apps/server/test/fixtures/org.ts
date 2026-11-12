/**
 * The org tests' helpers: people placed on a company's chart (the members helpers add them without a place), the
 * agents and org paths, an agent made through the API, raw reads of the positions and audit rows a change leaves, and
 * the org module's side of a membership's start and end for the services tested without the app (`testChart`). For
 * the lifecycle tests (S2.4): a company whose owner has an admin under them, a person invited by someone and accepted
 * at the fake provider, the server learning of a membership's start or end by each path (a webhook delivery, the
 * reconcile on sign-in, the self reconcile, Sync now, the periodic reconcile of the jobs loop), and the chart as the
 * API shows it. The access profiles' helpers (S3.4, tool profiles since S7.1b) are `org/profiles.ts`, re-exported here.
 */
import { auditLog, type DbHandle, orgPositions, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import type { NormalizedIdentityEvent } from '@mwc/shared/identity';
import { validateChart } from '@mwc/shared/org-chart';
import { captureLogger, getJson, seedAgent, testConfig } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { expect } from 'vitest';
import { moduleJobs } from '../../src/app.ts';
import { SELF_RECONCILE_INTERVAL_MS } from '../../src/modules/identity/service.ts';
import type { MemberView } from '../../src/modules/members/schemas.ts';
import type { AgentDetailView, OrgChartView } from '../../src/modules/org/schemas.ts';
import { memberChart } from '../../src/modules/org/service/lifecycle.ts';
import { deliverEvents, redelivered } from './identity/webhooks.ts';
import { acceptAtProvider, invite, memberWithEmail, runOutbox, signUp } from './members/invitations.ts';
import { as, type MembersCompany, membersCompany } from './members/members.ts';
import { type AuthWorld, addPerson, bearer, newSubject, type Person } from './platform/auth.ts';

export type { AgentDetailView, OrgChartView };

export const agentsPath = (company: Pick<MembersCompany, 'companyId'>, agentId?: string, query = '') =>
  `/api/companies/${company.companyId}/agents${agentId === undefined ? '' : `/${agentId}`}${query}`;

export const positionPath = (company: Pick<MembersCompany, 'companyId'>, principalId: string) =>
  `/api/companies/${company.companyId}/org/positions/${principalId}`;

export const chartPath = (company: Pick<MembersCompany, 'companyId'>) =>
  `/api/companies/${company.companyId}/org/chart`;

/** The org chart a membership that starts or ends moves its person on, as `createApp` composes it. */
export const testChart = (logger: Logger = captureLogger().logger) => memberChart({ logger });

/** Puts a principal on the chart straight into the table (no rules checked). */
export async function place(
  db: DbHandle,
  companyId: string,
  principalId: string,
  reportsTo: string | null,
  title: string | null = null,
): Promise<void> {
  const t = await tenant(db, companyId);
  await t.insert(orgPositions, { principalId, reportsToPrincipalId: reportsTo, title });
}

/** Takes a principal off the chart straight in the table (a place lost before S2.4's lifecycle hooks). */
export async function unplace(db: DbHandle, companyId: string, principalId: string): Promise<void> {
  const t = await tenant(db, companyId);
  await t.delete(orgPositions, eq(orgPositions.principalId, principalId));
}

/** A person with a membership (`role`, active unless said) placed under `reportsTo` (the owner by default). */
export async function placedMember(
  w: AuthWorld,
  company: MembersCompany,
  role: MembershipRole,
  options: { reportsTo?: string | null; status?: MembershipStatus } = {},
): Promise<Person> {
  const person = await addPerson(w.t.db, w.fake, company.companyId, {
    role,
    status: options.status ?? 'active',
  });
  const reportsTo = options.reportsTo === undefined ? company.owner.principalId : options.reportsTo;
  await place(w.t.db, company.companyId, person.principalId, reportsTo);
  return person;
}

/** Creates an agent through the API as `person` (the test fails on anything but a 201). */
export async function makeAgent(
  w: AuthWorld,
  company: MembersCompany,
  person: Person,
  body: Record<string, unknown> = {},
): Promise<AgentDetailView> {
  const res = await as(w, person)('POST', agentsPath(company), {
    name: 'SLOP BOX',
    roleTitle: 'Coder',
    ...body,
  });
  if (res.status !== 201) throw new Error(`POST agents answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as AgentDetailView;
}

/** The stored place of a principal, as `[reportsTo, title]`, or undefined when it has none. */
export async function placeOf(db: DbHandle, companyId: string, principalId: string) {
  const [row] = await rawDb(db)
    .select()
    .from(orgPositions)
    .where(and(eq(orgPositions.companyId, companyId), eq(orgPositions.principalId, principalId)));
  return row && ([row.reportsToPrincipalId, row.title] as const);
}

/** The audit rows of one entity, oldest first, as `[action, field, old, new]`. */
export async function auditTrail(db: DbHandle, entityType: string, entityId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
  return rows.map((row) => [row.action, row.field, row.oldValue, row.newValue] as const);
}

/** The audit rows of one entity, oldest first, with who made them. */
export async function auditRows(db: DbHandle, entityType: string, entityId: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
  return rows.map(({ id: _id, createdAt: _at, ...row }) => row);
}

/** The paths by which the server learns that a membership started or ended at the provider. */
export const LEARNING_PATHS = [
  'webhook',
  'first sign-in',
  'self reconcile',
  'sync now',
  'periodic reconcile',
] as const;
export type LearningPath = (typeof LEARNING_PATHS)[number];

/** A company linked to an organization at the fake, its owner at the top, and an admin under the owner. */
export async function orgCompany(w: AuthWorld): Promise<MembersCompany & { readonly admin: Person }> {
  const company = await membersCompany(w);
  return { ...company, admin: await placedMember(w, company, 'admin') };
}

/** Someone who signed up at the fake and accepted an invitation there, with the events the fake sent for it. */
export interface Joiner {
  readonly subject: string;
  readonly email: string;
  readonly invitationId: string;
  readonly events: NormalizedIdentityEvent[];
}

/**
 * `by` invites a new email as `role` (to report to `reportsTo`, when given) through the API and the outbox sends it;
 * then the invitee signs up and accepts at the fake, which sends the events of both.
 */
export async function acceptedFrom(
  w: AuthWorld,
  company: MembersCompany,
  by: Person,
  role: 'owner' | 'admin' | 'member' = 'member',
  reportsTo?: string,
): Promise<Joiner> {
  const email = `${newSubject('joiner')}@joiners.test`;
  const sent = await invite(w, company, email, role, by, { reportsToPrincipalId: reportsTo });
  await runOutbox(w, company.companyId);
  w.fake.drainEvents();
  const person = signUp(w, sent.email);
  await acceptAtProvider(w, sent.id, person.subject);
  return { ...person, invitationId: sent.id, events: w.fake.drainEvents() };
}

/**
 * Someone `by` invited as an admin, who joined through the provider (learned by webhook), with a member and an agent
 * under them on the chart, the agent with an agent of its own.
 */
export async function managerWithReports(w: AuthWorld, company: MembersCompany, by: Person) {
  const joiner = await acceptedFrom(w, company, by, 'admin');
  await deliverEvents(w, joiner.events);
  const member = (await memberWithEmail(w, company, joiner.email)) as MemberView;
  const report = await placedMember(w, company, 'member', { reportsTo: member.principalId });
  const agent = (await seedAgent(w.t.db, company.companyId, { reportsTo: member.principalId })).principal.id;
  const subAgent = (await seedAgent(w.t.db, company.companyId, { reportsTo: agent })).principal.id;
  return { joiner, member, report, agent, subAgent };
}

/** The deps the jobs loop runs with, on the test app's database, fake and clock. */
const jobsOf = (w: AuthWorld) =>
  moduleJobs({
    db: w.t.db,
    config: testConfig,
    logger: w.t.logger,
    version: 'test',
    clock: w.clock,
    identity: w.fake,
  });

/** Delivers the events (round 1) or copies of them under new delivery ids; returns the membership event's id. */
async function viaWebhook(w: AuthWorld, events: readonly NormalizedIdentityEvent[], round: number) {
  const deliveries = round === 1 ? events : events.map((event) => redelivered(event));
  expect(new Set(await deliverEvents(w, deliveries))).toEqual(new Set(['processed']));
  const changed = deliveries.find((event) => event.type.startsWith('membership.'));
  return changed?.externalEventId ?? null;
}

/**
 * The server learns what happened at the provider to `subject`'s membership by `path`, a `round` after the first being
 * the same path again (another delivery id, another session, the next self reconcile turn). `events` are what the fake
 * sent for it. Returns the request id the audit rows of what changed carry.
 */
export async function learnBy(
  w: AuthWorld,
  company: MembersCompany,
  path: LearningPath,
  change: {
    readonly subject: string;
    readonly events: readonly NormalizedIdentityEvent[];
    readonly label: string;
  },
  round = 1,
): Promise<string | null> {
  const label = `${change.label}-${round}`;
  const headers = { ...bearer(`fake:${change.subject};sid=sess_${label}`), 'x-request-id': label };
  if (path === 'webhook') return viaWebhook(w, change.events, round);
  if (path === 'first sign-in') expect((await getJson(w.t.app, '/api/me', headers)).status).toBe(200);
  if (path === 'self reconcile') {
    if (round > 1) w.clock.advance(SELF_RECONCILE_INTERVAL_MS);
    const res = await w.t.app.request('/api/me/reconcile', { method: 'POST', headers });
    expect(res.status).toBe(200);
  }
  if (path === 'sync now') {
    const synced = await as(w, company.owner, label)('POST', `/api/companies/${company.companyId}/sync`);
    expect(synced.status).toBe(200);
  }
  if (path === 'periodic reconcile') {
    await jobsOf(w).reconcileCompany(company.companyId);
    return null;
  }
  return label;
}

/** The chart as the owner reads it through the API; a chart that breaks an invariant fails the test. */
export async function chartOf(w: AuthWorld, company: MembersCompany): Promise<OrgChartView> {
  const res = await as(w, company.owner)('GET', chartPath(company));
  expect(res.status).toBe(200);
  const chart = res.body as OrgChartView;
  expect(validateChart(chart.nodes)).toEqual([]);
  return chart;
}

/** Whom each of `principalIds` reports to on the chart (undefined: not on it). */
export async function managersOf(w: AuthWorld, company: MembersCompany, principalIds: readonly string[]) {
  const nodes = new Map((await chartOf(w, company)).nodes.map((node) => [node.principalId, node.reportsTo]));
  return principalIds.map((id) => (nodes.has(id) ? nodes.get(id) : undefined));
}

/** The `org_position` audit rows of a principal, oldest first, as `[action, by, requestId, old, new]`. */
export async function positionAudit(w: AuthWorld, principalId: string) {
  return (await auditRows(w.t.db, 'org_position', principalId)).map(
    (row) =>
      [row.action, row.actorPrincipalId ?? row.actorKind, row.requestId, row.oldValue, row.newValue] as const,
  );
}

export * from './org/profiles.ts';
