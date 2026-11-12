import { useMemo, useRef, useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { OrgCalls } from '../../api/org.ts';
import type { OrgChart, OrgTreeNode } from '../../api/types.ts';
import type { CanvasHandle } from '../../components/org/ChartCanvas.tsx';
import { COMPANY } from '../../components/org/ChartCard.tsx';
import { nodesById } from '../../components/org/chart.ts';
import { type LayoutNode, layoutChart } from '../../components/org/layout.ts';
import type { AgentLinks } from '../agents/links.ts';
import type { ChartFlowItem } from '../flows/access.ts';
import type { MenuAt } from './ChartMenu.tsx';
import type { ChartAbilities, ChartActions, ChartTask } from './ChartMenuItems.tsx';
import { dropMove, dropPlan } from './drop-targets.ts';
import type { FlowFocus } from './flow/flow-focus.ts';
import { useFlowFocus } from './flow/use-flow-focus.ts';
import { useChartDrag } from './use-chart-drag.ts';
import { useChartMoves } from './use-chart-moves.ts';

const toLayout = (node: OrgTreeNode): LayoutNode => ({
  id: node.principalId,
  children: node.children.map(toLayout),
});

/** "Hire under" goes to the hire form with the manager chosen (`?reportsTo=`). */
export function hireUnder(hire: string, principalId: string): string {
  return `${hire}${hire.includes('?') ? '&' : '?'}reportsTo=${encodeURIComponent(principalId)}`;
}

export interface BoardInput {
  readonly chart: OrgChart | undefined;
  readonly calls: OrgCalls;
  readonly links: AgentLinks;
  readonly abilities: ChartAbilities;
  /** A manager's flow item in its card's menu. */
  readonly flowItem: (principalId: string) => ChartFlowItem | undefined;
  readonly onChanged: (self?: boolean) => void;
  /** The flow highlighted on the chart (`?flow=`), if any. */
  readonly focus?: FlowFocus | undefined;
}

/**
 * The org chart board's state: the chart with the moves being made, its layout, the card being dragged and where it
 * may go, the open menu and sheet, and what the menus' items do (sheets, pause and resume, the hire form, pages).
 */
export function useBoard({ chart: loaded, calls, links, abilities, flowItem, onChanged, focus }: BoardInput) {
  const moves = useChartMoves({ chart: loaded, calls, onChanged });
  const chart = moves.chart;
  const [menu, setMenu] = useState<MenuAt>();
  const [task, setTask] = useState<ChartTask>();
  const canvas = useRef<CanvasHandle>(null);
  const frame = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => nodesById(chart?.nodes ?? []), [chart]);
  const drag = useChartDrag({
    enabled: abilities.admin,
    canvas,
    viewport: () => frame.current?.getBoundingClientRect(),
    onDrop: (principalId, target) => {
      const to = chart ? dropMove(dropPlan(chart.nodes, principalId), target) : undefined;
      if (to !== undefined) void moves.move(principalId, to);
    },
  });
  const dragged = drag.dragging?.principalId;
  const plan = useMemo(
    () => (chart && dragged ? dropPlan(chart.nodes, dragged) : undefined),
    [chart, dragged],
  );
  const layout = useMemo(
    () => layoutChart({ id: COMPANY, children: (chart?.tree ?? []).map(toLayout) }),
    [chart],
  );
  const focused = useFlowFocus(focus, layout, canvas, chart !== undefined);
  const setStatus = (agentId: string, status: 'active' | 'paused') => {
    calls.update(agentId, { status }).then(
      (agent) => {
        moves.notify({
          tone: 'success',
          text: `${status === 'paused' ? 'Paused' : 'Resumed'} ${agent.name}.`,
        });
        onChanged();
      },
      (failure: unknown) => moves.notify({ tone: 'error', text: friendlyMessage(failure) }),
    );
  };
  const actions: ChartActions = {
    task: setTask,
    setStatus,
    hireHref: (principalId) => hireUnder(links.hire, principalId),
    agentHref: (agent) => links.agent({ slug: agent.slug, id: agent.agentId }),
    peopleHref: links.people,
    flow: flowItem,
  };
  return {
    moves,
    chart,
    nodes,
    menu,
    setMenu,
    task,
    setTask,
    canvas,
    frame,
    drag,
    plan,
    layout,
    focused,
    actions,
  };
}

export type Board = ReturnType<typeof useBoard>;
