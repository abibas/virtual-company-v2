import { type ChartIndex, type ChartNode, managerOf, onLoop, personAtOrAbove } from './chart.ts';

/**
 * Why a chart breaks an invariant: the move refusals that a stored chart can show (`self`, `cycle`, `agent_root`,
 * `agent_manages_person`, `chain_without_person`), a principal listed twice, or a manager not on the chart.
 */
export type ChartViolationCode =
  | 'duplicate_principal'
  | 'unknown_manager'
  | 'self'
  | 'cycle'
  | 'agent_root'
  | 'agent_manages_person'
  | 'chain_without_person';

/** One broken invariant, on the principal whose entry breaks it, with a sentence a UI can show. */
export interface ChartViolation {
  readonly code: ChartViolationCode;
  readonly principalId: string;
  readonly message: string;
}

const MESSAGES: Readonly<Record<ChartViolationCode, string>> = {
  duplicate_principal: 'This person or agent is on the chart more than once.',
  unknown_manager: 'This person or agent reports to someone who is not on the chart.',
  self: 'This person or agent reports to themselves.',
  cycle: 'This person or agent is in a reporting loop.',
  agent_root: 'This agent reports to nobody; only people can be at the top of the chart.',
  agent_manages_person: 'This person reports to an agent; people report only to people.',
  chain_without_person: 'This agent has no person above it.',
};

/** A violation of `code` on `principalId`. */
export function violation(code: ChartViolationCode, principalId: string): ChartViolation {
  return { code, principalId, message: MESSAGES[code] };
}

/**
 * The invariants a principal's first entry breaks. Each is checked on its own, so one broken link can show under
 * several codes (an agent whose manager is not on the chart has no person above it either).
 */
export function violationsOf(index: ChartIndex, node: ChartNode): ChartViolationCode[] {
  const codes: ChartViolationCode[] = [];
  const manager = managerOf(index, node);
  if (node.reportsTo !== null && manager === undefined) codes.push('unknown_manager');
  if (node.reportsTo === node.principalId) codes.push('self');
  else if (onLoop(index, node)) codes.push('cycle');
  if (node.kind === 'person') {
    if (manager?.kind === 'agent') codes.push('agent_manages_person');
  } else if (node.reportsTo === null) codes.push('agent_root');
  else if (personAtOrAbove(index, node) === undefined) codes.push('chain_without_person');
  return codes;
}
