import { roleAtLeast } from '@mwc/shared/roles';
import { CalendarPlus, Pencil, Plus, Workflow } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import type { Board, Flow, FlowCalls } from '../../../api/flows.ts';
import type { ChartNode, OrgChart } from '../../../api/types.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { navigate } from '../../../app/router.tsx';
import { LoadState } from '../../../components/data/LoadState.tsx';
import { nodeName, nodesById } from '../../../components/org/chart.ts';
import { Button, ButtonLink } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import { leadsTeam, myPrincipal, type Viewer } from '../access.ts';
import { BoardView } from '../board/BoardView.tsx';
import { NewTaskSheet } from '../board/NewTaskSheet.tsx';
import { drawnSteps, FlowDrawing } from '../drawing/FlowDrawing.tsx';
import { FlowText } from '../drawing/FlowText.tsx';
import { FlowEditor } from '../editor/FlowEditor.tsx';
import type { FlowLinks, TeamTab } from '../links.ts';
import { NewSprintSheet } from '../sprints/NewSprintSheet.tsx';
import { sprintSince } from '../sprints/words.ts';
import { TeamHeader } from './TeamHeader.tsx';

export interface TeamViewProps {
  /** The Lead's address under `/flows/`. */
  readonly address: string;
  readonly tab: TeamTab;
  /** The Flow tab's editor is open (`?edit=1`). */
  readonly editing: boolean;
  /** The team's flow; null while its Lead has none. */
  readonly flow: Flow | null;
  /** The Lead on the chart. */
  readonly lead: ChartNode | undefined;
  readonly chart: OrgChart;
  readonly viewer: Viewer;
  /** The board and the written form, once there is a flow. */
  readonly board: Loaded<Board> | undefined;
  readonly text: Loaded<string> | undefined;
  readonly links: FlowLinks;
  readonly calls: FlowCalls;
  /** The flow was made or changed: read it (and its board) again. */
  readonly onFlowSaved: (flow: Flow) => void;
  readonly onBoardChanged: () => void;
  /** The Flow tab's "Lead wakes up on" section (S6c), for those who lead the team; none hides it. */
  readonly wakes?: ReactNode;
  /** The Team chat tab: the team room. */
  readonly room?: ReactNode;
  /** The Sprints tab (T-37): the flow's sprints and their reports. */
  readonly sprints?: ReactNode;
}

/** The Flow tab: the drawing and the written form, or the editor in their place; then the Lead's wake-ups (S6c). */
function FlowTab({
  props,
  flow,
  nodes,
}: {
  readonly props: TeamViewProps;
  readonly flow: Flow;
  readonly nodes: ReadonlyMap<string, ChartNode>;
}) {
  const { links, address } = props;
  if (props.editing && leadsTeam(props.viewer, flow.lead.principalId)) {
    return (
      <div className="flex flex-col gap-4">
        <FlowEditor
          subject={{ kind: 'edit', flow }}
          chart={props.chart}
          calls={props.calls}
          meUserId={props.viewer.userId}
          onSaved={(saved) => {
            navigate(links.team(address, 'flow'));
            props.onFlowSaved(saved);
          }}
          onCancel={() => navigate(links.team(address, 'flow'))}
        />
        {props.wakes}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm">
        <FlowDrawing steps={drawnSteps(flow)} nodes={nodes} />
      </Card>
      {props.text && <FlowText text={props.text} />}
      {props.wakes}
    </div>
  );
}

/** A Lead without a flow: the editor to make one for those who lead the team, a line for everyone else. */
function NoFlow({ props, lead }: { readonly props: TeamViewProps; readonly lead: ChartNode | undefined }) {
  if (lead && leadsTeam(props.viewer, lead.principalId)) {
    return (
      <FlowEditor
        subject={{ kind: 'create', lead }}
        chart={props.chart}
        calls={props.calls}
        meUserId={props.viewer.userId}
        onSaved={(saved) => {
          navigate(props.links.team(props.address, 'flow'));
          props.onFlowSaved(saved);
        }}
        onCancel={() => navigate(props.links.flows)}
      />
    );
  }
  return (
    <Card>
      <EmptyState icon={Workflow} title={lead ? 'No flow yet' : 'No one on the chart here'} />
    </Card>
  );
}

/** The board, loaded: its columns, with the drag for those who lead the team. */
function BoardTab({
  props,
  nodes,
  leads,
}: {
  readonly props: TeamViewProps;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly leads: boolean;
}) {
  if (!props.board) return null;
  return (
    <LoadState
      loaded={props.board}
      label="Loading the board…"
      skeleton={<Skeleton className="h-64 rounded-2xl" />}
    >
      {(board) => (
        <BoardView
          board={board}
          nodes={nodes}
          me={myPrincipal(props.viewer)}
          leads={leads}
          links={props.links}
          calls={props.calls}
          autoTake={props.flow?.autoTake ? props.flow.inProgressLimit : null}
          onMoved={props.onBoardChanged}
        />
      )}
    </LoadState>
  );
}

/**
 * The tab's action in the header: on the Board its current sprint ("Sprint 4 · since Mon 16 Nov, 08:30"), New sprint…
 * (those who lead the team, T-37) and New task (member and up); Edit on the Flow (those who lead the team).
 */
function TeamAction({
  props,
  leads,
  onAdd,
  onNewSprint,
}: {
  readonly props: TeamViewProps;
  readonly leads: boolean;
  readonly onAdd: () => void;
  readonly onNewSprint: () => void;
}) {
  const { flow, tab } = props;
  if (flow && tab === 'board') {
    const sprint = props.board?.data?.sprint;
    return (
      <>
        {sprint && <span className="text-xs font-medium text-ink-2">{sprintSince(sprint)}</span>}
        {sprint && leads && (
          <Button size="sm" icon={CalendarPlus} onClick={onNewSprint}>
            New sprint…
          </Button>
        )}
        {roleAtLeast(props.viewer.role, 'member') && (
          <Button size="sm" tone="primary" icon={Plus} onClick={onAdd}>
            New task
          </Button>
        )}
      </>
    );
  }
  if (!flow || tab !== 'flow' || !leads || props.editing) return null;
  return (
    <ButtonLink size="sm" icon={Pencil} href={props.links.team(props.address, 'flow', true)}>
      Edit
    </ButtonLink>
  );
}

/**
 * A team's page (`/:slug/flows/<lead>`): its header row, then the Board (with its sprint, New sprint… and New task),
 * the Flow (with Edit for the Lead's people and admins), the Sprints (T-37) or the Team chat (the team room). The company's route and the design gallery both render it.
 */
export function TeamView(props: TeamViewProps) {
  const { flow, lead, chart, viewer, tab } = props;
  const nodes = useMemo(() => nodesById(chart.nodes), [chart]);
  const [adding, setAdding] = useState(false);
  const [newSprint, setNewSprint] = useState(false);
  const leads = leadsTeam(viewer, flow?.lead.principalId ?? lead?.principalId ?? '');
  const headLead = flow?.lead ?? (lead ? { principalId: lead.principalId, name: nodeName(lead) } : undefined);
  return (
    <>
      <TeamHeader
        title={flow?.name ?? headLead?.name ?? 'Flow'}
        lead={headLead}
        nodes={nodes}
        address={props.address}
        tab={flow ? tab : undefined}
        links={props.links}
        action={
          <TeamAction
            props={props}
            leads={leads}
            onAdd={() => setAdding(true)}
            onNewSprint={() => setNewSprint(true)}
          />
        }
      />
      {!flow && <NoFlow props={props} lead={lead} />}
      {flow && tab === 'flow' && <FlowTab props={props} flow={flow} nodes={nodes} />}
      {flow && tab === 'board' && <BoardTab props={props} nodes={nodes} leads={leads} />}
      {flow && tab === 'sprints' && props.sprints}
      {flow && tab === 'chat' && props.room}
      {newSprint && props.board?.data && (
        <NewSprintSheet
          board={props.board.data}
          calls={props.calls}
          onClose={() => setNewSprint(false)}
          onStarted={() => {
            setNewSprint(false);
            props.onBoardChanged();
          }}
        />
      )}
      {adding && flow && (
        <NewTaskSheet
          flow={flow}
          leads={leads}
          calls={props.calls}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            props.onBoardChanged();
          }}
        />
      )}
    </>
  );
}
