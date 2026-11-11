import { useMemo } from 'react';
import { useApi } from '../../../api/context.ts';
import { flowCalls, useFlow, useTask } from '../../../api/flows.ts';
import { useOrgChart } from '../../../api/org.ts';
import { useCompany } from '../../../app/company.ts';
import { ErrorBlock, LoadingBlock } from '../../../components/data/LoadState.tsx';
import { companyFlowLinks } from '../../../features/flows/links.ts';
import { TaskView } from '../../../features/flows/task/TaskView.tsx';

/** `/:slug/tasks/T-12` (the notifications link here): a task, its flow drawn with its step, its moves and history. */
export function TaskPage({ taskKey }: { readonly taskKey: string }) {
  const { membership, me } = useCompany();
  const { companyId } = membership;
  const api = useApi();
  const calls = useMemo(() => flowCalls(api, companyId), [api, companyId]);
  const task = useTask(companyId, taskKey);
  const flow = useFlow(companyId, task.data?.flow.id);
  const chart = useOrgChart(companyId);
  if (task.error !== undefined) return <ErrorBlock error={task.error} onRetry={task.reload} />;
  if (chart.error !== undefined) return <ErrorBlock error={chart.error} onRetry={chart.reload} />;
  if (task.data === undefined || chart.data === undefined) return <LoadingBlock label="Loading the task…" />;
  return (
    <TaskView
      task={task.data}
      flow={flow.data}
      chart={chart.data}
      viewer={{ role: membership.role, userId: me.user.id, chart: chart.data }}
      links={companyFlowLinks(membership.slug)}
      calls={calls}
      onChanged={() => {
        task.reload();
        flow.reload();
      }}
    />
  );
}
