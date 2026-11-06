import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { ApiError, call } from './errors.ts';
import type {
  AgentChanges,
  AgentDetail,
  AgentFilter,
  AgentList,
  AgentPlacement,
  MachineChoice,
  NewAgent,
  OrgChart,
  PlacementChange,
  PositionChange,
} from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/** The company's chart: its active members and agents not archived, and the same as a tree. */
export function useOrgChart(companyId: string): Loaded<OrgChart> {
  const api = useApi();
  return useLoad(`org-chart:${companyId}`, () =>
    call(api.api.companies[':companyId'].org.chart.$get({ param: { companyId } })),
  );
}

/** The company's agents: the active and paused ones, or those of one status, or `all`. */
export function useAgentList(companyId: string, status?: AgentFilter): Loaded<AgentList> {
  const api = useApi();
  return useLoad(`agents:${companyId}:${status ?? ''}`, () =>
    call(
      api.api.companies[':companyId'].agents.$get({
        param: { companyId },
        query: status ? { status } : {},
      }),
    ),
  );
}

/**
 * One agent with its instructions, by its address: its slug, or its id (the address of an agent whose slug is a word
 * the routes keep, such as `new`). Archived agents are found too.
 */
export function useAgentAt(companyId: string, ref: string): Loaded<AgentDetail> {
  const api = useApi();
  return useLoad(`agent:${companyId}:${ref}`, async () => {
    const agents = api.api.companies[':companyId'].agents;
    const { agents: all } = await call(agents.$get({ param: { companyId }, query: { status: 'all' } }));
    const found = all.find((agent) => agent.slug === ref || agent.id === ref);
    if (!found) throw new ApiError(404, 'agent_not_found', 'There is no agent at this address.');
    return call(agents[':agentId'].$get({ param: { companyId, agentId: found.id } }));
  });
}

/** The org changes of one company: hire an agent, change one, move or title someone on the chart. */
export function orgCalls(api: Api, companyId: string) {
  const company = api.api.companies[':companyId'];
  return {
    hire: (agent: NewAgent) => call(company.agents.$post({ param: { companyId }, json: agent })),
    update: (agentId: string, changes: AgentChanges) =>
      call(company.agents[':agentId'].$patch({ param: { companyId, agentId }, json: changes })),
    place: (principalId: string, change: PositionChange) =>
      call(company.org.positions[':principalId'].$put({ param: { companyId, principalId }, json: change })),
  };
}

export type OrgCalls = ReturnType<typeof orgCalls>;

/** Where an agent runs (S4.7): its default placement, or null; nothing is asked for a new agent (`agentId` undefined). */
export function useAgentPlacement(companyId: string, agentId: string | undefined): Loaded<AgentPlacement> {
  const api = useApi();
  return useLoad(`placement:${companyId}:${agentId ?? ''}`, async () => {
    if (agentId === undefined) return null;
    const placement = api.api.companies[':companyId'].agents[':agentId'].placement;
    return (await call(placement.$get({ param: { companyId, agentId } }))).placement;
  });
}

/** The company's machines, by name, for the placement's machine select. */
export function useMachineChoices(companyId: string): Loaded<readonly MachineChoice[]> {
  const api = useApi();
  return useLoad(`machine-choices:${companyId}`, async () => {
    const machines = api.api.companies[':companyId'].machines;
    return (await call(machines.$get({ param: { companyId } }))).machines;
  });
}

/** Choosing and taking away where an agent runs (admins and owners). */
export function placementCalls(api: Api, companyId: string) {
  const placement = api.api.companies[':companyId'].agents[':agentId'].placement;
  return {
    set: (agentId: string, change: PlacementChange) =>
      call(placement.$put({ param: { companyId, agentId }, json: change })),
    remove: (agentId: string) => call(placement.$delete({ param: { companyId, agentId } })),
  };
}

export type PlacementCalls = ReturnType<typeof placementCalls>;
