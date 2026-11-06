import { Bot, Plus } from 'lucide-react';
import type { OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { count } from '../../components/data/format.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { nodesById } from '../../components/org/chart.ts';
import { OrgTree } from '../../components/org/OrgTree.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { ChartNodeCard, type ChartView } from './ChartNodeCard.tsx';

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

/** A chart loading: a card on top, two below it. */
function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-24 w-60 rounded-xl" />
      <div className="flex gap-8">
        <Skeleton className="h-24 w-60 rounded-xl" />
        <Skeleton className="h-24 w-60 rounded-xl max-sm:hidden" />
      </div>
    </div>
  );
}

/** No agent on the chart yet: what an agent is here, and (admins) the way to hire one. */
function NoAgents({ admin, hireHref }: { readonly admin: boolean; readonly hireHref: string }) {
  return (
    <EmptyState
      icon={Bot}
      tone="teal"
      title="No agents yet"
      action={
        admin && (
          <ButtonLink href={hireHref} tone="primary" icon={Plus}>
            Hire an agent
          </ButtonLink>
        )
      }
    >
      {admin
        ? 'An agent joins the chart under you, or under the person or agent you choose.'
        : 'Admins and owners hire agents; they show here, beside the people they report to.'}
    </EmptyState>
  );
}

/** The chart tab: everyone in the company as a tree on a dotted canvas, each card with its actions. */
export function OrgChartPanel({
  loaded,
  ...view
}: Omit<ChartView, 'chart' | 'nodes'> & { readonly loaded: Loaded<OrgChart> }) {
  const chart = loaded.data;
  const noAgents = chart !== undefined && !chart.nodes.some((node) => node.kind === 'agent');
  return (
    <Panel
      title="Org chart"
      description="Who reports to whom. People are blue and agents teal; every agent answers to a person."
      actions={<Legend chart={chart} />}
    >
      <div className="canvas-dots -mx-5 -mb-5 rounded-b-2xl border-t border-line px-4 py-6 md:-mx-6 md:-mb-6 md:px-6">
        <LoadState loaded={loaded} label="Loading the chart…" skeleton={<ChartSkeleton />}>
          {(data) => {
            const chartView: ChartView = { ...view, chart: data, nodes: nodesById(data.nodes) };
            return (
              <OrgTree
                tree={data.tree}
                renderNode={(place) => <ChartNodeCard place={place} view={chartView} />}
              />
            );
          }}
        </LoadState>
        {noAgents && <NoAgents admin={view.admin} hireHref={view.links.hire} />}
      </div>
    </Panel>
  );
}
