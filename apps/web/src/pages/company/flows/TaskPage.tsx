import { roleAtLeast } from '@mwc/shared/roles';
import { useCallback, useMemo } from 'react';
import { useApi } from '../../../api/context.ts';
import { BOARD_EVERY_MS, flowCalls, useFlow, useTask } from '../../../api/flows.ts';
import { useEvery } from '../../../api/notifications.ts';
import { useOrgChart } from '../../../api/org.ts';
import { artifactCalls, type TaskArtifact, useTaskArtifacts } from '../../../api/task-artifacts.ts';
import type { OrgChart } from '../../../api/types.ts';
import { useCompany } from '../../../app/company.ts';
import { ErrorBlock, LoadingBlock } from '../../../components/data/LoadState.tsx';
import { nodesById } from '../../../components/org/chart.ts';
import { chatsPath } from '../../../features/agents/links.ts';
import type { RoundSpan, TaskConversation } from '../../../features/flows/conversations/model.ts';
import { TaskThread } from '../../../features/flows/conversations/TaskThread.tsx';
import { companyFlowLinks } from '../../../features/flows/links.ts';
import type { TaskRuns } from '../../../features/flows/task/runs.ts';
import { TaskView } from '../../../features/flows/task/TaskView.tsx';

/** The task's runs on the page: its artifacts (read again when it changes) and each conversation's live thread. */
function useTaskRuns(
  taskKey: string,
  version: string,
  chart: OrgChart | undefined,
  onChanged: () => void,
): TaskRuns {
  const { membership } = useCompany();
  const { companyId, slug, role } = membership;
  const api = useApi();
  const artifacts = useTaskArtifacts(companyId, taskKey, version);
  const nodes = useMemo(() => nodesById(chart?.nodes ?? []), [chart]);
  const bytes = useMemo(() => {
    const calls = artifactCalls(api, companyId);
    return (artifact: TaskArtifact) => calls.bytes(taskKey, artifact.id);
  }, [api, companyId, taskKey]);
  const thread = (conversation: TaskConversation, span: RoundSpan | undefined) => {
    const node = conversation.agent ? nodes.get(conversation.agent.principalId) : undefined;
    const agentId = node?.kind === 'agent' ? node.agent.agentId : undefined;
    const address = conversation.agent?.slug ?? agentId;
    return (
      <TaskThread
        key={conversation.chatId}
        companyId={companyId}
        conversation={conversation}
        span={span}
        nodes={nodes}
        agentId={agentId}
        admin={roleAtLeast(role, 'admin')}
        chatHref={address ? chatsPath(slug, address, conversation.chatId) : undefined}
        onChanged={onChanged}
      />
    );
  };
  return { artifacts, bytes, thread };
}

/**
 * `/:slug/tasks/T-12` (the notifications link here): a task, its flow drawn with its step, its moves and history, its
 * steps' conversations (live) and artifacts; read again every 30 seconds while the page is visible.
 */
export function TaskPage({ taskKey }: { readonly taskKey: string }) {
  const { membership, me } = useCompany();
  const { companyId } = membership;
  const api = useApi();
  const calls = useMemo(() => flowCalls(api, companyId), [api, companyId]);
  const task = useTask(companyId, taskKey);
  const flow = useFlow(companyId, task.data?.flow.id);
  const chart = useOrgChart(companyId);
  const { reload: reloadTask } = task;
  const { reload: reloadFlow } = flow;
  const changed = useCallback(() => {
    reloadTask();
    reloadFlow();
  }, [reloadTask, reloadFlow]);
  useEvery(BOARD_EVERY_MS, reloadTask);
  const version = task.data ? `${task.data.updatedAt}:${task.data.artifacts}` : '';
  const runs = useTaskRuns(taskKey, version, chart.data, reloadTask);
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
      runs={runs}
      onChanged={changed}
    />
  );
}
