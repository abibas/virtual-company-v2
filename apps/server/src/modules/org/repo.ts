import {
  type Agent,
  type AuditEntry,
  agents,
  auditChanges,
  invitations,
  isUuid,
  type Membership,
  memberships,
  type OrgPosition,
  orgPositions,
  principals,
  type TenantDb,
  type TenantSet,
  type TenantValues,
} from '@mwc/db';
import type { AgentStatus } from '@mwc/shared/enums';
import { asc, eq, inArray, ne } from 'drizzle-orm';
import { nameRows } from './repo/names.ts';
import { profileRows } from './repo/profiles.ts';

/** Every position of the company, in the order they were placed: the chart's stable order. */
const positions = (t: TenantDb): Promise<OrgPosition[]> =>
  t.select(orgPositions).orderBy(asc(orgPositions.createdAt), asc(orgPositions.principalId));

/** The active memberships, in the order people joined: the people who are on the chart. */
const activeMembers = (t: TenantDb): Promise<Membership[]> =>
  t
    .select(memberships, eq(memberships.status, 'active'))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));

/** The agents not archived: the agents who are on the chart. */
const liveAgents = (t: TenantDb): Promise<Agent[]> => t.select(agents, ne(agents.status, 'archived'));

/** The agents of these statuses (all when undefined), in the order they were created. */
const listAgents = (t: TenantDb, statuses?: readonly AgentStatus[]): Promise<Agent[]> =>
  t
    .select(agents, statuses === undefined ? undefined : inArray(agents.status, [...statuses]))
    .orderBy(asc(agents.createdAt), asc(agents.id));

/** One agent of this company by id; undefined for an unknown or malformed id, or another company's. */
async function getAgent(t: TenantDb, id: string): Promise<Agent | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await t.select(agents, eq(agents.id, id));
  return row;
}

/** One principal's position, if it has one. */
async function getPosition(t: TenantDb, principalId: string): Promise<OrgPosition | undefined> {
  const [row] = await t.select(orgPositions, eq(orgPositions.principalId, principalId));
  return row;
}

/**
 * Who sent this invitation of the company and whom it says the invitee reports to (principals, null for none);
 * undefined when there is no such invitation.
 */
async function invitationOf(
  t: TenantDb,
  invitationId: string,
): Promise<{ readonly invitedBy: string | null; readonly reportsTo: string | null } | undefined> {
  const fields = { invitedBy: invitations.invitedByPrincipalId, reportsTo: invitations.reportsToPrincipalId };
  const [row] = await t.selectFields(invitations, fields, eq(invitations.id, invitationId));
  return row;
}

/** The slugs every agent of the company holds, archived ones too (a slug stays taken). */
async function takenSlugs(t: TenantDb): Promise<Set<string>> {
  return new Set((await t.selectFields(agents, { slug: agents.slug })).map((row) => row.slug));
}

/** The agent's principal (kind `agent`, with the id the caller chose) and the agent on it. */
async function insertAgent(t: TenantDb, values: TenantValues<typeof agents>): Promise<Agent> {
  await t.insert(principals, { id: values.principalId, kind: 'agent' });
  const [row] = (await t.insert(agents, values).returning()) as [Agent];
  return row;
}

async function updateAgent(t: TenantDb, id: string, set: TenantSet<typeof agents>): Promise<Agent> {
  const [row] = (await t.update(agents, set, eq(agents.id, id)).returning()) as [Agent];
  return row;
}

/** Places a principal on the chart: a new position, or one left behind replaced (an agent back from the archive). */
async function placePosition(
  t: TenantDb,
  values: { principalId: string; reportsToPrincipalId: string | null },
): Promise<OrgPosition> {
  const [row] = (await t
    .insert(orgPositions, { ...values, title: null })
    .onConflictDoUpdate({
      target: [orgPositions.companyId, orgPositions.principalId],
      set: { reportsToPrincipalId: values.reportsToPrincipalId, title: null },
    })
    .returning()) as [OrgPosition];
  return row;
}

async function updatePosition(
  t: TenantDb,
  principalId: string,
  set: TenantSet<typeof orgPositions>,
): Promise<OrgPosition> {
  const where = eq(orgPositions.principalId, principalId);
  const [row] = (await t.update(orgPositions, set, where).returning()) as [OrgPosition];
  return row;
}

/** Takes a principal off the chart; returns its position as it was, if it had one. */
async function removePosition(t: TenantDb, principalId: string): Promise<OrgPosition | undefined> {
  const [row] = await t.delete(orgPositions, eq(orgPositions.principalId, principalId)).returning();
  return row;
}

/**
 * The org module's data access, through the company's tenant only: the agents, the positions, the active
 * memberships (who of the people is on the chart) and who invited a person and under whom, the company row's lock that serializes
 * every change of the chart, and the audit rows; the access profiles the agents and defaults point at
 * (`repo/profiles.ts`, S3.4); and who principals are, for their names (`repo/names.ts`).
 */
export function orgRepo() {
  return {
    lock: (t: TenantDb) => t.lockCompany(),
    positions,
    activeMembers,
    liveAgents,
    listAgents,
    getAgent,
    getPosition,
    invitationOf,
    takenSlugs,
    insertAgent,
    updateAgent,
    placePosition,
    updatePosition,
    removePosition,
    ...profileRows,
    ...nameRows,
    audit: (t: TenantDb, entry: AuditEntry) => auditChanges(t, entry),
  };
}

export type OrgRepo = ReturnType<typeof orgRepo>;
