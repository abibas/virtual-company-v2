import type { TenantDb } from '@mwc/db';
import { nearestPersonUp, peopleAtOrAbove } from '@mwc/shared/org-chart';
import { orgOf, type PrincipalNames } from '../../org/index.ts';
import type { Team } from '../rules/access.ts';

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

/** The principals' names as flows and tasks show them, read with the org module's `principalNames`. */
export type Names = PrincipalNames;
