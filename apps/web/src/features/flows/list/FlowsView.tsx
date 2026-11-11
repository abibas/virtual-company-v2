import { ChevronDown, Plus, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import type { Board, FlowList } from '../../../api/flows.ts';
import type { OrgChart } from '../../../api/types.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { LoadState } from '../../../components/data/LoadState.tsx';
import { Menu, MenuItem, MenuLabel } from '../../../components/forms/Menu.tsx';
import { Breadcrumbs } from '../../../components/layout/Breadcrumbs.tsx';
import { nodeName, nodesById } from '../../../components/org/chart.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import { flowCandidates, nodeAddress, type Viewer } from '../access.ts';
import { Face } from '../Face.tsx';
import { type FlowLinks, leadAddress } from '../links.ts';
import { FlowCard } from './FlowCard.tsx';

export interface FlowsViewProps {
  readonly companyId: string;
  readonly flows: Loaded<FlowList>;
  readonly chart: OrgChart | undefined;
  readonly viewer: Viewer;
  readonly links: FlowLinks;
  /** Reads a flow's board for its card's counts (the company's `useFlowCounts`, the gallery's samples). */
  readonly useBoard: (companyId: string, flowId: string) => Loaded<Board>;
}

/** "Create a flow": the managers without one that the viewer may lead, each opening the editor on its team's page. */
function CreateFlow({ props, flows }: { readonly props: FlowsViewProps; readonly flows: FlowList }) {
  const chart = props.chart;
  const candidates = flowCandidates(props.viewer, flows.flows);
  if (!chart || candidates.length === 0) return null;
  const nodes = nodesById(chart.nodes);
  return (
    <Menu
      align="end"
      width="w-72"
      trigger={(trigger) => (
        <Button {...trigger} size="sm" tone="primary" icon={Plus} trailingIcon={ChevronDown}>
          Create a flow
        </Button>
      )}
    >
      <MenuLabel>Lead</MenuLabel>
      {candidates.map((node) => (
        <MenuItem
          key={node.principalId}
          href={props.links.team(nodeAddress(node), 'flow')}
          leading={<Face who={{ principalId: node.principalId, name: nodeName(node) }} nodes={nodes} />}
        >
          {nodeName(node)}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** One flow's card, with its board read for the counts. */
function LiveCard({
  props,
  flow,
}: {
  readonly props: FlowsViewProps;
  readonly flow: FlowList['flows'][number];
}) {
  const board = props.useBoard(props.companyId, flow.id);
  const nodes = useMemo(() => nodesById(props.chart?.nodes ?? []), [props.chart]);
  return <FlowCard flow={flow} board={board} nodes={nodes} href={props.links.team(leadAddress(flow.lead))} />;
}

/**
 * The Flows page (`/:slug/flows`): every team's flow as a card (its Lead, its steps as coloured chips with their
 * counts, Queued, Done and Escalated), and "Create a flow" for a manager without one. The company's route and the
 * design gallery both render it.
 */
export function FlowsView(props: FlowsViewProps) {
  return (
    <>
      <h1 className="sr-only">Flows</h1>
      <LoadState
        loaded={props.flows}
        label="Loading the flows…"
        skeleton={<Skeleton className="h-36 rounded-2xl" />}
      >
        {(flows) => (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Breadcrumbs
                items={[{ label: 'Company structure', href: props.links.structure }, { label: 'Flows' }]}
              />
              <div className="ml-auto">
                <CreateFlow props={props} flows={flows} />
              </div>
            </div>
            {flows.flows.length === 0 ? (
              <Card>
                <EmptyState icon={Workflow} title="No flows yet" />
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {flows.flows.map((flow) => (
                  <LiveCard key={flow.id} props={props} flow={flow} />
                ))}
              </div>
            )}
          </>
        )}
      </LoadState>
    </>
  );
}
