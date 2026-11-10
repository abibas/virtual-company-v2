import { type MoveVerdict, moveVerdict } from '@mwc/shared/org-chart';
import type { ChartNode } from '../../api/types.ts';
import { COMPANY, type DropState } from '../../components/org/ChartCard.tsx';

/** Where a dragged card may go: each place's state, and the org rules' verdict of a drop there. */
export interface DropPlan {
  readonly principalId: string;
  readonly states: ReadonlyMap<string, DropState>;
  readonly verdicts: ReadonlyMap<string, MoveVerdict>;
}

/**
 * Every place a dragged principal could be dropped (each card, and `COMPANY` for the top) judged by the org rules the
 * server judges with (`moveVerdict` of `@mwc/shared/org-chart`): the card itself is the `source`, its manager now is
 * `current`, a place the rules allow is `valid`, any other `refused` with the rules' sentence. The server stays the
 * judge: a drop it refuses all the same rolls back with its own message.
 */
export function dropPlan(nodes: readonly ChartNode[], principalId: string): DropPlan {
  const chart = nodes.map(({ principalId: id, kind, reportsTo }) => ({ principalId: id, kind, reportsTo }));
  const dragged = chart.find((node) => node.principalId === principalId);
  const states = new Map<string, DropState>();
  const verdicts = new Map<string, MoveVerdict>();
  for (const target of [COMPANY, ...chart.map((node) => node.principalId)]) {
    if (target === principalId) {
      states.set(target, 'source');
      continue;
    }
    const reportsTo = target === COMPANY ? null : target;
    const verdict = moveVerdict(chart, principalId, reportsTo);
    verdicts.set(target, verdict);
    const current = dragged !== undefined && dragged.reportsTo === reportsTo;
    states.set(target, verdict.ok ? (current ? 'current' : 'valid') : 'refused');
  }
  return { principalId, states, verdicts };
}

/** The state a place shows: `over` for the valid place under the pointer. */
export function stateAt(
  plan: DropPlan | undefined,
  id: string,
  over: string | undefined,
): DropState | undefined {
  const state = plan?.states.get(id);
  return state === 'valid' && over === id ? 'over' : state;
}

/** Where a drop on `target` puts the dragged principal (null: the top), or undefined when there is nothing to do. */
export function dropMove(plan: DropPlan, target: string | undefined): string | null | undefined {
  if (target === undefined || plan.states.get(target) !== 'valid') return undefined;
  return target === COMPANY ? null : target;
}
