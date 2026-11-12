import { KanbanSquare, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PrincipalRef } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { Tabs } from '../../../components/forms/Segmented.tsx';
import { Breadcrumbs, type Crumb } from '../../../components/layout/Breadcrumbs.tsx';
import { Who } from '../Face.tsx';
import { chartWithFlow, type FlowLinks, type TeamTab } from '../links.ts';
import { ShowOnChart } from './ShowOnChart.tsx';

/** Company structure / Flows, then the rest of the path. */
export const flowCrumbs = (links: FlowLinks, ...rest: Crumb[]): Crumb[] => [
  { label: 'Company structure', href: links.structure },
  { label: 'Flows', href: links.flows },
  ...rest,
];

/**
 * A team's page's one header row: the path (Company structure / Flows / the flow), its Lead, then Show on org chart,
 * the Board and Flow tabs (none before the team has a flow) and the tab's action on the right.
 */
export function TeamHeader({
  title,
  lead,
  nodes,
  address,
  tab,
  links,
  action,
}: {
  readonly title: string;
  readonly lead: Pick<PrincipalRef, 'principalId' | 'name'> | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly address: string;
  /** Undefined: no tabs (the team has no flow yet). */
  readonly tab: TeamTab | undefined;
  readonly links: FlowLinks;
  readonly action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="sr-only">{title}</h1>
      <Breadcrumbs items={flowCrumbs(links, { label: title })} />
      {lead && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-dim">
          Lead
          <Who who={lead} nodes={nodes} className="font-semibold text-ink-2" />
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {tab && <ShowOnChart href={chartWithFlow(links, address)} />}
        {tab && (
          <Tabs
            label="Team views"
            size="sm"
            items={[
              { href: links.team(address), label: 'Board', icon: KanbanSquare, current: tab === 'board' },
              { href: links.team(address, 'flow'), label: 'Flow', icon: Workflow, current: tab === 'flow' },
            ]}
          />
        )}
        {action}
      </div>
    </div>
  );
}
