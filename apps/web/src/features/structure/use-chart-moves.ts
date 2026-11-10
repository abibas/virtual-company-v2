import { buildTree, type ChartMove } from '@mwc/shared/org-chart';
import { useCallback, useRef, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { OrgCalls } from '../../api/org.ts';
import type { OrgChart } from '../../api/types.ts';
import { nodeName } from '../../components/org/chart.ts';

/** What the last move said: a sentence, its tone, and (after a move) the way to undo it. */
export interface MoveNotice {
  readonly id: number;
  readonly tone: 'success' | 'error';
  readonly text: string;
  readonly undo?: (() => void) | undefined;
}

/** The chart with `moves` made: each principal's new manager, and the tree built again from the nodes. */
export function withMoves(chart: OrgChart, moves: readonly ChartMove[]): OrgChart {
  const to = new Map(moves.map((move) => [move.principalId, move.reportsTo]));
  const nodes = chart.nodes.map((node) =>
    to.has(node.principalId) ? { ...node, reportsTo: to.get(node.principalId) ?? null } : node,
  );
  return { nodes, tree: buildTree(nodes) };
}

/** "Moved Vega under Ihor Herasko", "… to the top of the chart", "… back under …". */
function movedText(chart: OrgChart, principalId: string, reportsTo: string | null, back: boolean): string {
  const byId = new Map(chart.nodes.map((node) => [node.principalId, node]));
  const who = byId.get(principalId);
  const manager = reportsTo === null ? undefined : byId.get(reportsTo);
  const name = who ? nodeName(who) : 'Them';
  const place = manager ? `under ${nodeName(manager)}` : 'to the top of the chart';
  return `Moved ${name} ${back ? 'back ' : ''}${place}.`;
}

/**
 * Moving people and agents on the chart, optimistically: the chart shows the move at once, `PUT /org/positions` makes
 * it, and the chart is read again (`onChanged`); the shown move stays until that new chart arrives, so nothing jumps
 * back meanwhile. A refusal rolls the move back and says the server's sentence; a move made can be undone once.
 */
export function useChartMoves({
  chart,
  calls,
  onChanged,
}: {
  readonly chart: OrgChart | undefined;
  readonly calls: OrgCalls;
  readonly onChanged: () => void;
}) {
  const [pending, setPending] = useState<{ readonly base: OrgChart; readonly moves: readonly ChartMove[] }>();
  const [notice, setNotice] = useState<MoveNotice>();
  const latest = useRef(chart);
  latest.current = chart;
  const count = useRef(0);
  const say = useCallback((note: Omit<MoveNotice, 'id'>) => setNotice({ ...note, id: ++count.current }), []);

  const move = useCallback(
    async (principalId: string, reportsTo: string | null, back = false) => {
      const base = latest.current;
      const node = base?.nodes.find((n) => n.principalId === principalId);
      if (!base || !node) return;
      const before = node.reportsTo;
      const made: ChartMove = { principalId, reportsTo };
      setPending((p) => ({ base, moves: p && p.base === base ? [...p.moves, made] : [made] }));
      setNotice(undefined);
      try {
        await calls.place(principalId, { reportsToPrincipalId: reportsTo });
        const text = movedText(base, principalId, reportsTo, back);
        say({ tone: 'success', text, undo: back ? undefined : () => void move(principalId, before, true) });
        onChanged();
      } catch (failure) {
        setPending((p) => p && { ...p, moves: p.moves.filter((m) => m !== made) });
        say({ tone: 'error', text: `${nodeName(node)} was not moved: ${friendlyMessage(failure)}` });
      }
    },
    [calls, onChanged, say],
  );

  const shown = chart && pending && pending.base === chart ? withMoves(chart, pending.moves) : chart;
  const dismiss = useCallback(() => setNotice(undefined), []);
  return { chart: shown, move, notice, notify: say, dismiss };
}
