import { useMemo } from 'react';
import type { FlowSummary } from '../../api/flows.ts';
import type { LiveTaskList } from '../../api/tasks.ts';
import type { OrgChart } from '../../api/types.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { nodesById } from '../../components/org/chart.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import type { TaskFilters as Filters } from './filters.ts';
import { TaskFilters } from './TaskFilters.tsx';
import { TaskTable } from './TaskTable.tsx';

export interface TasksViewProps {
  readonly filters: Filters;
  readonly onFilters: (filters: Filters, typing?: boolean) => void;
  readonly list: LiveTaskList;
  readonly flows: readonly FlowSummary[];
  readonly chart: OrgChart | undefined;
  /** The viewer's principal on the chart. */
  readonly me: string | undefined;
  /** A task's page, by its key. */
  readonly taskHref: (key: string) => string;
}

/**
 * The Tasks page (`/:slug/tasks`): every task of the company across its flows, the latest activity first, filtered by
 * state, flow, who has it and a search, with more loaded below on request. A row opens the task.
 */
export function TasksView({ filters, onFilters, list, flows, chart, me, taskHref }: TasksViewProps) {
  const nodes = useMemo(() => nodesById(chart?.nodes ?? []), [chart]);
  const names = useMemo(() => new Map(flows.map((flow) => [flow.id, flow.name])), [flows]);
  const ctx = { flowName: (id: string) => names.get(id) ?? '—', nodes, me, href: taskHref };
  return (
    <>
      <PageHeader title="Tasks" />
      <TaskFilters filters={filters} flows={flows} nodes={chart?.nodes ?? []} me={me} onChange={onFilters} />
      <Card>
        <LoadState loaded={list} label="Loading the tasks…" skeleton={<SkeletonRows />}>
          {() =>
            list.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-dim">No tasks</p>
            ) : (
              <>
                <TaskTable rows={list.rows} ctx={ctx} />
                {list.hasMore && (
                  <div className="mt-4 flex justify-center">
                    <Button size="sm" busy={list.loadingMore} onClick={() => void list.more()}>
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )
          }
        </LoadState>
      </Card>
    </>
  );
}
