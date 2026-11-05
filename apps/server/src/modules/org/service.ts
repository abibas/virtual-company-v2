import type { TenantDb } from '@mwc/db';
import type { AgentStatus } from '@mwc/shared/enums';
import type { ServerDeps } from '../../platform/env.ts';
import { orgRepo } from './repo.ts';
import { AGENT_NOT_FOUND } from './rules/agents.ts';
import type { AgentListFilter, AgentView, CreateAgent, UpdateAgent, UpdatePosition } from './schemas.ts';
import { type AgentResult, createAgent, updateAgent } from './service/agents.ts';
import type { Caller } from './service/audit.ts';
import { chartReader } from './service/chart.ts';
import { setPosition } from './service/positions.ts';
import { agentDetail, agentView } from './service/read.ts';

export type { Caller } from './service/audit.ts';

/** The statuses a list filter keeps: not archived by default, one status, or all of them (undefined). */
const LIST_STATUSES: Readonly<Record<string, readonly AgentStatus[] | undefined>> = {
  default: ['active', 'paused'],
  active: ['active'],
  paused: ['paused'],
  archived: ['archived'],
  all: undefined,
};

/**
 * The org module's logic: the agents (list, read, create, change, archive: `service/agents.ts`,
 * `service/status.ts`), the positions (`service/positions.ts`) and the chart (`service/chart.ts`). Every change runs
 * under the company row's lock, so two changes never pass the org rules each on a chart the other changes.
 */
export function orgService(deps: Pick<ServerDeps, 'db' | 'logger'>) {
  const repo = orgRepo();
  return {
    /** The company's agents, in the order they were created, each with its place on the chart. */
    async list(t: TenantDb, filter: AgentListFilter): Promise<AgentView[]> {
      const rows = await repo.listAgents(t, LIST_STATUSES[filter ?? 'default']);
      const places = new Map((await repo.positions(t)).map((position) => [position.principalId, position]));
      return rows.map((agent) => agentView(agent, places.get(agent.principalId)));
    },

    /** One agent with its instructions (archived ones too); 404 for an unknown one or another company's. */
    async get(t: TenantDb, agentId: string): Promise<AgentResult<404>> {
      const agent = await repo.getAgent(t, agentId);
      if (agent === undefined) return AGENT_NOT_FOUND;
      return { ok: true, agent: agentDetail(agent, await repo.getPosition(t, agent.principalId)) };
    },

    create: (t: TenantDb, caller: Caller, input: CreateAgent) => createAgent(repo, t, caller, input),
    update: (t: TenantDb, caller: Caller, agentId: string, patch: UpdateAgent) =>
      updateAgent(repo, t, caller, { agentId, patch }),
    setPosition: (t: TenantDb, caller: Caller, principalId: string, body: UpdatePosition) =>
      setPosition(repo, t, caller, { principalId, body }),
    chart: chartReader(deps, repo),
  };
}

export type OrgService = ReturnType<typeof orgService>;
