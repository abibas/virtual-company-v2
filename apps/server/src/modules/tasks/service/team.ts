import type { DbHandle, TenantDb } from '@mwc/db';
import { nearestPersonUp, peopleAtOrAbove } from '@mwc/shared/org-chart';
import { profilesOf } from '../../identity/service.ts';
import { orgOf } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import type { Team } from '../rules/access.ts';
import type { PrincipalRef } from '../schemas.ts';

/** The company's chart as the flows read it: who is on it, who is a person, and who leads a team. */
export interface Roster {
  /** True for an active member or an agent not archived. */
  onChart(principalId: string): boolean;
  /** True for an active member (a person on the chart). */
  isPerson(principalId: string): boolean;
  /** The team of a Lead: the people who lead it (the Lead when a person, then every person above it). */
  team(leadPrincipalId: string): Team;
  /** The nearest person at or above the Lead, who hears of its escalations and done tasks; null for none. */
  leadPerson(leadPrincipalId: string): string | null;
}

/** The chart now, read through `t` (in the caller's transaction when it is one: the org module reads with `t`). */
export async function rosterOf(t: TenantDb): Promise<Roster> {
  const org = await orgOf(t);
  const on = new Set(org.chart.map((node) => node.principalId));
  return {
    onChart: (id) => on.has(id),
    isPerson: (id) => org.members.has(id) && on.has(id),
    team: (lead) => ({ lead, leadPeople: peopleAtOrAbove(org.chart, lead) }),
    leadPerson: (lead) => nearestPersonUp(org.chart, lead),
  };
}

/** What a principal who is neither an agent nor a person of the company is called. */
export const SOMEONE = 'Someone';

/** The principals' names as flows and tasks show them; a principal of none of the company's is `SOMEONE`. */
export type Names = (principalId: string) => PrincipalRef;

/**
 * Reads the names of these principals: an agent's name and slug (archived ones too), a person's display name or email
 * from the identity module's service (former members too). Outside any transaction: the identity read runs on the
 * database handle, not the tenant's connection.
 */
export async function namesOf(
  db: DbHandle,
  repo: TasksRepo,
  t: TenantDb,
  ids: Iterable<string | null | undefined>,
): Promise<Names> {
  const wanted = [...new Set([...ids].filter((id): id is string => typeof id === 'string'))];
  const known = new Map<string, PrincipalRef>();
  for (const agent of await repo.names.agentsOf(t, wanted)) {
    known.set(agent.principalId, {
      principalId: agent.principalId,
      kind: 'agent',
      name: agent.name,
      slug: agent.slug,
    });
  }
  const members = await repo.names.membersOf(t, wanted);
  const profiles = await profilesOf(
    db,
    members.map((member) => member.userId),
  );
  for (const member of members) {
    const profile = profiles.get(member.userId);
    if (profile === undefined) continue;
    const name = profile.displayName ?? profile.primaryEmail;
    known.set(member.principalId, { principalId: member.principalId, kind: 'person', name, slug: null });
  }
  return (id) => known.get(id) ?? { principalId: id, kind: 'person', name: SOMEONE, slug: null };
}
