import type { MembershipRole } from '@mwc/shared/enums';
import { useMemo } from 'react';
import { useApi } from '../../api/context.ts';
import { flowCalls, useFlows } from '../../api/flows.ts';
import { useOrgChart } from '../../api/org.ts';
import type { AgentRef } from '../../components/feed/kinds.ts';
import { leadsTeam } from '../flows/access.ts';
import { companyFlowLinks } from '../flows/links.ts';
import { type QuickMade, QuickTask, type QuickTeam } from './QuickTask.tsx';

/**
 * The quick-create dock on the company's own data: its flows, each team's Lead (an agent's icon from `faces`), and who
 * leads which team (the chart, as the flows' pages judge it; the server stays the judge). A task goes in with `POST
 * …/tasks`: queued, or into the flow's first step for those who lead the team. `onMade` follows (the inbox reads again).
 */
export function LiveQuickTask({
  companyId,
  slug,
  role,
  userId,
  faces,
  onMade,
}: {
  readonly companyId: string;
  readonly slug: string;
  readonly role: MembershipRole;
  readonly userId: string;
  readonly faces: ReadonlyMap<string, AgentRef>;
  readonly onMade: () => void;
}) {
  const api = useApi();
  const flows = useFlows(companyId);
  const chart = useOrgChart(companyId);
  const links = companyFlowLinks(slug);
  const teams = useMemo<QuickTeam[]>(() => {
    const viewer = { role, userId, chart: chart.data };
    return (flows.data?.flows ?? []).map((flow) => ({
      flowId: flow.id,
      flowName: flow.name,
      lead: flow.lead,
      face: faces.get(flow.lead.principalId),
      leads: leadsTeam(viewer, flow.lead.principalId),
    }));
  }, [flows.data, chart.data, faces, role, userId]);
  if (flows.data === undefined) return null;
  const create = async (team: QuickTeam, title: string): Promise<QuickMade> => {
    const calls = flowCalls(api, companyId);
    const first = team.leads ? (await calls.flow(team.flowId)).steps[0]?.id : undefined;
    const task = await calls.createTask({ flowId: team.flowId, title, ...(first ? { stepId: first } : {}) });
    onMade();
    return { key: task.key, where: task.step ? `at ${task.step.name}` : 'queued' };
  };
  return (
    <QuickTask
      teams={teams}
      companyId={companyId}
      onCreate={create}
      taskHref={links.task}
      flowsHref={links.flows}
    />
  );
}
