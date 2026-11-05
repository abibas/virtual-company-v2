import { applyMoves, type Chart, type ChartMove, type ChartViolation, reparentOnRemoval } from '../rules.ts';
import { addedViolations, earliestOwner, type OrgState } from './placement.ts';

// What a membership's start and end do on the chart (S2.4): where a person who joins goes, and how the reports of a
// person who leaves move up. Pure; `service/lifecycle.ts` reads the rows and writes what these decide.

/** The people on the chart (active members with a position). */
const peopleOn = (org: OrgState) =>
  new Set(org.chart.filter((node) => node.kind === 'person').map((node) => node.principalId));

/**
 * The company's earliest active owner on the chart other than `principalId` (by when they joined, then id), or null:
 * who takes a newcomer nobody invited, and the agents of a person who leaves that nobody else can take.
 */
export function earliestOwnerBut(org: OrgState, principalId: string): string | null {
  const people = peopleOn(org);
  return earliestOwner(
    org.memberList.filter((member) => member.principalId !== principalId && people.has(member.principalId)),
  );
}

/**
 * Whom a person whose membership became active reports to: whoever invited them, when that is a person on the chart
 * (not themselves); else the company's earliest active owner on the chart other than them; else nobody (the top).
 * Owners included: a person at the top is valid, and a company's first owner is placed when it is created.
 */
export function joiningManager(org: OrgState, principalId: string, inviter: string | null): string | null {
  if (inviter !== null && inviter !== principalId && peopleOn(org).has(inviter)) return inviter;
  return earliestOwnerBut(org, principalId);
}

/**
 * The chart with a leaving person on it where their position puts them, also when their membership is no longer
 * active (so no longer on `org.chart`): their reports move up from there. Unchanged when they have no position.
 */
export function chartWithLeaver(org: OrgState, principalId: string): Chart {
  const position = org.positions.get(principalId);
  if (position === undefined || org.chart.some((node) => node.principalId === principalId)) return org.chart;
  const order = [...org.positions.keys()];
  const leaver = { principalId, kind: 'person', reportsTo: position.reportsToPrincipalId } as const;
  return [...org.chart, leaver].sort((a, b) => order.indexOf(a.principalId) - order.indexOf(b.principalId));
}

/** A person leaving the chart: the moves of their direct reports, and what the chart then breaks that it did not. */
export interface LeavingPlan {
  readonly moves: readonly ChartMove[];
  /** Never a reason to keep the person: their access ends whatever the chart looks like afterwards. */
  readonly violations: readonly ChartViolation[];
}

/**
 * When a person's membership ends (removed, suspended): their direct reports move with `reparentOnRemoval`, falling
 * back on the earliest active owner other than them; `violations` lists what the chart without them breaks that it did
 * not break before (an agent left at the top when no other owner is on the chart), for the caller to log.
 */
export function leavingPlan(org: OrgState, principalId: string): LeavingPlan {
  const chart = chartWithLeaver(org, principalId);
  const moves = reparentOnRemoval(chart, principalId, earliestOwnerBut(org, principalId));
  return { moves, violations: addedViolations(chart, applyMoves(chart, moves, principalId)) };
}
