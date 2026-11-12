import type { MembershipRole, StepEndAction } from '@mwc/shared/enums';
import {
  mentionedAgents,
  type RoomAgentName,
  type StepEndDetails,
  stepEndWords,
  type TaskDecision,
} from '@mwc/shared/flows';
import { type Chart, descendants, peopleAtOrAbove } from '@mwc/shared/org-chart';
import { roleAtLeast } from '@mwc/shared/roles';
import { refuse } from '../rules.ts';
import type { Transition } from './machine.ts';

// A flow's team room (docs/processes.md "The team room"), pure: who is in it (its agents and its people), who may write,
// whom a person's message asks, the cap on those answers an hour, the words when agents were not asked, and a step's
// end as a line (its move and the agent's own words). The service reads the rows and writes what these return.

/** Who is in a room: its agents (the Lead first, then each step's in order) and its people, each once. */
export interface RoomMembers {
  readonly agents: readonly string[];
  readonly people: readonly string[];
}

/** Ids once each, in their first order. */
const once = (ids: readonly string[]) => [...new Set(ids)];

/**
 * The room's members from the chart: the Lead when an agent and every step's agent; the people who lead the team (the
 * Lead when a person and everyone above it, `peopleAtOrAbove`), the people placed under the Lead, and every step's
 * person. A principal off the chart (a removed member, an archived agent) is not in it.
 */
export function roomMembers(
  chart: Chart,
  leadPrincipalId: string,
  assignees: readonly string[],
): RoomMembers {
  const kind = new Map(chart.map((node) => [node.principalId, node.kind]));
  const of = (ids: readonly string[], wanted: 'agent' | 'person') =>
    ids.filter((id) => kind.get(id) === wanted);
  const team = [leadPrincipalId, ...assignees];
  const under = descendants(chart, leadPrincipalId).map((node) => node.principalId);
  return {
    agents: once(of(team, 'agent')),
    people: once([
      ...peopleAtOrAbove(chart, leadPrincipalId),
      ...of(under, 'person'),
      ...of(assignees, 'person'),
    ]),
  };
}

/** True when the caller writes in the room: an admin or owner, or one of its people who is a member or more. */
export const mayWrite = (
  caller: { readonly principalId: string; readonly role: MembershipRole },
  members: RoomMembers,
): boolean =>
  roleAtLeast(caller.role, 'admin') ||
  (roleAtLeast(caller.role, 'member') && members.people.includes(caller.principalId));

export const NOT_IN_TEAM = refuse(
  403,
  'not_in_team',
  "Only the team's people and the company's admins and owners write in its room",
);

/** The agents a message asks: those it names with "@" when it names any, else every agent of the room. */
export function recipients(text: string, agents: readonly RoomAgentName[]): string[] {
  const named = mentionedAgents(text, agents);
  return named.length > 0 ? named : agents.map((agent) => agent.principalId);
}

/** True when asking `wanted` more answers would pass the room's cap for the hour. */
export const overCap = (askedLastHour: number, wanted: number, maxPerHour: number): boolean =>
  wanted > 0 && askedLastHour + wanted > maxPerHour;

/** The words over the cap: who was not asked and why. */
export const capWords = (names: readonly string[], maxPerHour: number): string =>
  `Not asked: ${names.join(', ')}. The room is at its ${maxPerHour} answers this hour.`;

/** The words for agents a turn could not be queued for: one line, or one per agent. */
export function notAskedWords(items: readonly { readonly name: string; readonly why: string }[]): string {
  if (items.length === 1) {
    const [item] = items as [{ readonly name: string; readonly why: string }];
    return `${item.name} was not asked: ${item.why}`;
  }
  return ['Not asked:', ...items.map((item) => `- ${item.name}: ${item.why}`)].join('\n');
}

/** A step's end as the room's line keeps it: its details, and the agent's own words. */
export interface StepEndLine {
  readonly details: StepEndDetails;
  readonly words: string;
}

const ACTION: Readonly<Record<'hand_on' | 'pass' | 'approve', StepEndAction>> = {
  hand_on: 'hand_on',
  pass: 'pass',
  approve: 'approve',
};

/**
 * The line of a decision applied as a move (`transition`): handed on, passed or approved to the next step (or Done),
 * sent back to its step, or escalated past the limit; its words are a send-back's reason, else the decision's note, else
 * the turn's reply.
 */
export function movedLine(
  decision: Pick<TaskDecision, 'action' | 'reason' | 'note' | 'round'>,
  from: string,
  transition: Pick<Transition, 'outcome'> & { readonly to: string | null },
  reply: string | null,
): StepEndLine {
  const round = decision.round;
  if (decision.action === 'send_back') {
    const action = transition.outcome === 'escalated' ? 'escalated' : 'send_back';
    const to = action === 'escalated' ? null : transition.to;
    return { details: { action, from, to, round }, words: stepEndWords(decision.reason) };
  }
  const action = ACTION[decision.action as keyof typeof ACTION] ?? 'hand_on';
  const to = transition.outcome === 'done' ? null : transition.to;
  return { details: { action, from, to, round }, words: stepEndWords(decision.note ?? reply) };
}

/** The line of a step that stopped there: blocked by its agent, or its turn ended without a move. */
export const stoppedLine = (
  action: 'blocked' | 'turn_ended',
  from: string,
  round: number,
  words: string | null,
): StepEndLine => ({ details: { action, from, to: null, round }, words: stepEndWords(words) });
