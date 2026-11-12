import { useCallback, useMemo } from 'react';
import { useFlows } from '../../../api/flows.ts';
import { useOrgChart } from '../../../api/org.ts';
import { useTaskList } from '../../../api/tasks.ts';
import { useCompany } from '../../../app/company.ts';
import { navigate, useLocation } from '../../../app/router.tsx';
import { myPrincipal } from '../../../features/flows/access.ts';
import { companyFlowLinks } from '../../../features/flows/links.ts';
import { filtersOf, queryOf, searchOf, type TaskFilters } from '../../../features/tasks/filters.ts';
import { TasksView } from '../../../features/tasks/TasksView.tsx';

/** `/:slug/tasks`: every task of the company, with its filters in the address. */
export function TasksPage() {
  const { membership, me } = useCompany();
  const { companyId } = membership;
  const location = useLocation();
  const search = location.search.toString();
  const filters = useMemo(() => filtersOf(new URLSearchParams(search)), [search]);
  const chart = useOrgChart(companyId);
  const flows = useFlows(companyId);
  const mine = myPrincipal({ role: membership.role, userId: me.user.id, chart: chart.data });
  const query = useMemo(() => queryOf(filters, mine), [filters, mine]);
  const list = useTaskList(companyId, query);
  const links = companyFlowLinks(membership.slug);
  const { pathname } = location;
  const onFilters = useCallback(
    (next: TaskFilters, typing = false) => navigate(`${pathname}${searchOf(next)}`, { replace: typing }),
    [pathname],
  );
  return (
    <TasksView
      filters={filters}
      onFilters={onFilters}
      list={list}
      flows={flows.data?.flows ?? []}
      chart={chart.data}
      me={mine}
      taskHref={links.task}
    />
  );
}
