import { createPortal } from 'react-dom';
import type { OrgCalls } from '../../api/org.ts';
import type { ChartNode, OrgChart, OrgTreeNode } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { count } from '../../components/data/format.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { ChartCanvas } from '../../components/org/ChartCanvas.tsx';
import { COMPANY } from '../../components/org/ChartCard.tsx';
import { nodeName } from '../../components/org/chart.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import type { AgentLinks } from '../agents/links.ts';
import type { ChartFlowItem } from '../flows/access.ts';
import { CardButtons, ChartLayer, DragGhost } from './ChartLayer.tsx';
import { ChartMenu } from './ChartMenu.tsx';
import { type ChartAbilities, ChartMenuItems } from './ChartMenuItems.tsx';
import { ChartSheet } from './ChartSheets.tsx';
import type { DropPlan } from './drop-targets.ts';
import type { FlowFocus } from './flow/flow-focus.ts';
import { useFlowFocus } from './flow/use-flow-focus.ts';
import { MoveToast } from './MoveToast.tsx';
import { useFitOnToggle, useRequesterLayer, useWaitForRequesters } from './requesters/use-requester-layer.ts';
import type { ChartRequesters } from './requesters/use-requesters.ts';
import { WithRequesters } from './requesters/WithRequesters.tsx';
import { type Board, useBoard } from './use-board.ts';

export interface OrgChartBoardProps {
  readonly companyId: string;
  /** The company at the top of the chart: its name and its logo (an object URL, or null). */
  readonly company: { readonly name: string; readonly logo: string | null };
  readonly loaded: Loaded<OrgChart>;
  readonly calls: OrgCalls;
  readonly links: AgentLinks;
  readonly abilities: ChartAbilities;
  /** A manager's flow item in its card's menu: "Open its flow" or "Create its flow". */
  readonly flowItem: (principalId: string) => ChartFlowItem | undefined;
  /** The chart changed: read it again (`self`: the signed-in person's own role changed). */
  readonly onChanged: (self?: boolean) => void;
  /** The flow highlighted on the chart (`?flow=`): its members ringed, the rest faded, the view on them. */
  readonly focus?: FlowFocus | undefined;
  /** The Requesters column beside the tree (contacts and the agents they talk to), unless hidden. */
  readonly requesters?: ChartRequesters | undefined;
}

const orphansOf = (tree: readonly OrgTreeNode[]) =>
  new Set(tree.filter((top) => top.orphan).map((top) => top.principalId));

/** "3 people · 2 agents". */
function summaryOf(chart: OrgChart): string {
  const agents = chart.nodes.filter((node) => node.kind === 'agent').length;
  return `${count(chart.nodes.length - agents, 'person', 'people')} · ${count(agents, 'agent')}`;
}

/** How many people and agents the chart holds, in their colours. */
function Legend({ chart }: { readonly chart: OrgChart | undefined }) {
  if (!chart) return null;
  const agents = chart.nodes.filter((node) => node.kind === 'agent').length;
  return (
    <>
      <Badge tone="blue" dot>
        {count(chart.nodes.length - agents, 'person', 'people')}
      </Badge>
      <Badge tone="teal" dot>
        {count(agents, 'agent')}
      </Badge>
    </>
  );
}

/** The sentence under a dragged card's name: where a drop would put it, or the rules' reason it cannot go there. */
function dragHint(chart: OrgChart, plan: DropPlan, over: string | undefined) {
  const state = over === undefined ? undefined : plan.states.get(over);
  const verdict = over === undefined ? undefined : plan.verdicts.get(over);
  if (state === 'refused' && verdict && !verdict.ok) return { hint: verdict.message, refused: true };
  if (state === 'current') return { hint: 'Reports here already', refused: false };
  if (state === 'valid' && over === COMPANY)
    return { hint: 'Drop to put them at the top of the chart', refused: false };
  const manager = chart.nodes.find((node) => node.principalId === over);
  if (state === 'valid' && manager) return { hint: `Drop to report to ${nodeName(manager)}`, refused: false };
  return { hint: 'Drop on a manager, or on the company for the top', refused: false };
}

/** A card's buttons (the company's with `COMPANY`): + for admins and owners, ⋯ for a card, or the company's for them. */
const buttonsOf =
  (board: Board, company: string, admin: boolean) => (target: string, node: ChartNode | undefined) => (
    <CardButtons
      target={target}
      name={node ? nodeName(node) : company}
      add={admin}
      more={node !== undefined || admin}
      open={board.menu}
      onOpen={board.setMenu}
    />
  );

/**
 * The canvas with the chart on it (the tree, and the Requesters column with its links beside it), and the last move's
 * toast over it. The canvas first waits for the Requesters, so its first fit holds them.
 */
function BoardCanvas({ board, ...props }: OrgChartBoardProps & { readonly board: Board }) {
  const { chart, layout, drag } = board;
  const { abilities, requesters } = props;
  const req = useRequesterLayer(requesters, layout, props.focus, drag.dragging !== undefined);
  const focused = useFlowFocus(props.focus, layout, board.canvas, chart !== undefined, req);
  useFitOnToggle(requesters, board.canvas, req);
  const waiting = useWaitForRequesters(requesters, chart !== undefined);
  const buttons = buttonsOf(board, props.company.name, abilities.admin);
  return (
    <div ref={board.frame} className="relative">
      <LoadState
        loaded={props.loaded}
        label="Loading the chart…"
        skeleton={<Skeleton className="m-6 h-28 w-60 rounded-xl" />}
      >
        {() =>
          chart &&
          (waiting ? (
            <Skeleton className="m-6 h-28 w-60 rounded-xl" />
          ) : (
            <ChartCanvas
              key={props.companyId}
              width={req.width}
              height={req.height}
              storageKey={props.companyId}
              label="Org chart canvas"
              handle={board.canvas}
              onMove={() => board.setMenu(undefined)}
              className="h-[max(26rem,calc(100dvh-10.5rem))] rounded-2xl"
            >
              <WithRequesters layer={req} requesters={requesters}>
                <ChartLayer
                  layout={layout}
                  nodes={board.nodes}
                  orphans={orphansOf(chart.tree)}
                  company={{ ...props.company, summary: summaryOf(chart) }}
                  plan={board.plan}
                  over={drag.dragging?.over}
                  meUserId={abilities.meUserId}
                  draggable={abilities.admin}
                  grab={drag.grab}
                  buttons={buttons}
                  agentHref={(node) => board.actions.agentHref(node.agent)}
                  focus={focused}
                  hovered={req.hovered}
                  onAgentHover={req.agentHover}
                />
              </WithRequesters>
            </ChartCanvas>
          ))
        }
      </LoadState>
      <MoveToast notice={board.moves.notice} onDismiss={board.moves.dismiss} />
    </div>
  );
}

/** What opens over the page: the dragged card under the pointer, a card's menu, and the sheet a menu opened. */
function BoardOverlays({ board, ...props }: OrgChartBoardProps & { readonly board: Board }) {
  const { chart, plan, drag, menu, task, moves } = board;
  const ghost = drag.dragging && chart && plan && board.nodes.get(drag.dragging.principalId);
  const invited = (email: string, manager: string | undefined) =>
    moves.notify({
      tone: 'success',
      text: `An invitation is on its way to ${email}; they join ${manager ? `under ${manager}` : 'at the top'}.`,
    });
  return (
    <>
      {ghost &&
        createPortal(
          <DragGhost
            node={ghost}
            x={drag.dragging?.x ?? 0}
            y={drag.dragging?.y ?? 0}
            {...dragHint(chart, plan, drag.dragging?.over)}
          />,
          document.body,
        )}
      {menu && (
        <ChartMenu at={menu} label="Card actions" onClose={() => board.setMenu(undefined)}>
          <ChartMenuItems
            kind={menu.kind}
            node={board.nodes.get(menu.target)}
            abilities={props.abilities}
            actions={board.actions}
          />
        </ChartMenu>
      )}
      {task && chart && (
        <ChartSheet
          task={task}
          companyId={props.companyId}
          chart={chart}
          calls={props.calls}
          myRole={props.abilities.myRole}
          meUserId={props.abilities.meUserId}
          onClose={() => board.setTask(undefined)}
          onChanged={props.onChanged}
          onInvited={(invitation, manager) => invited(invitation.email, manager)}
        />
      )}
    </>
  );
}

/**
 * The Org chart tab: the company and everyone in it as a tree on a canvas that pans and zooms. Admins and owners drag a
 * card onto another (or onto the company, for the top) to change who it reports to, the places the org rules refuse
 * dimmed while they drag; each card's + hires an agent or invites a person under it, and its ⋯ opens, moves, titles,
 * pauses, archives or changes a role. Members and viewers read it.
 */
export function OrgChartBoard(props: OrgChartBoardProps) {
  const board = useBoard({ ...props, chart: props.loaded.data });
  return (
    // No header of its own (Ihor: the space is the chart's): the counts float at the canvas's top left.
    <Card as="section" aria-label="Org chart" padding="none">
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex gap-1.5">
        <Legend chart={board.chart} />
      </div>
      <BoardCanvas board={board} {...props} />
      <BoardOverlays board={board} {...props} />
    </Card>
  );
}
