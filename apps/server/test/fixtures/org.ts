/**
 * The org tests' helpers: people placed on a company's chart (the members helpers add them without a place), the
 * agents and org paths, an agent made through the API, and raw reads of the positions and audit rows a change leaves.
 */
import { auditLog, type DbHandle, orgPositions, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { and, asc, eq } from 'drizzle-orm';
import type { AgentDetailView, OrgChartView } from '../../src/modules/org/schemas.ts';
import { type AuthWorld, addPerson, type Person } from './auth.ts';
import { as, type MembersCompany } from './members.ts';

export type { AgentDetailView, OrgChartView };

export const agentsPath = (company: Pick<MembersCompany, 'companyId'>, agentId?: string, query = '') =>
  `/api/companies/${company.companyId}/agents${agentId === undefined ? '' : `/${agentId}`}${query}`;

export const positionPath = (company: Pick<MembersCompany, 'companyId'>, principalId: string) =>
  `/api/companies/${company.companyId}/org/positions/${principalId}`;

export const chartPath = (company: Pick<MembersCompany, 'companyId'>) =>
  `/api/companies/${company.companyId}/org/chart`;

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
