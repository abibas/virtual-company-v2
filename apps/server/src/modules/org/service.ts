import type { TenantDb } from '@mwc/db';
import type { AgentStatus } from '@mwc/shared/enums';
import type { ServerDeps } from '../../platform/env.ts';
import { placementsOf } from '../machines/service/placement.ts';
import { orgRepo } from './repo.ts';
import { AGENT_NOT_FOUND } from './rules/agents.ts';
import type { AgentListFilter, AgentView, CreateAgent, UpdateAgent, UpdatePosition } from './schemas.ts';
import { type AgentResult, createAgent, shownAgent, updateAgent } from './service/agents.ts';
import type { Caller } from './service/audit.ts';
import { chartReader } from './service/chart.ts';
import { setPosition } from './service/positions.ts';
import {
  auditProfileRemoval as auditRemoval,
  type ProfileUse,
  profileRefs,
  profileUses,
  setDefaultProfile,
} from './service/profiles.ts';
import { agentView } from './service/read.ts';

export type { Caller } from './service/audit.ts';
export type { ProfileUse } from './service/profiles.ts';

/** The company's agents (archived ones too) using one of these access profiles: their owner's list (S3.4). */
export function agentsUsingProfiles(t: TenantDb, profileIds: readonly string[]): Promise<ProfileUse[]> {
  return profileUses(orgRepo(), t, profileIds);
}

/**
 * Before its owner removes an access profile, in their transaction: the audit rows of the agents and defaults of this
 * company it leaves, by the owner, under the company's lock (S3.4).
 */
export function auditProfileRemoval(
  t: TenantDb,
  profileId: string,
  by: { readonly userId: string; readonly requestId: string },
): Promise<void> {
  return auditRemoval(orgRepo(), t, profileId, by);
}

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
 * `service/lifecycle.ts`), the positions (`service/positions.ts`), the chart (`service/chart.ts`) and the access
 * profiles agents use, with a member's default (`service/profiles.ts`). Every change runs under the company row's lock,
 * so two changes never pass the org rules each on a chart the other changes.
 */
export function orgService(deps: Pick<ServerDeps, 'db' | 'logger'>) {
  const repo = orgRepo();
  return {
    /**
     * The company's agents, in the order they were created, each with its place on the chart, its profile and where it
     * runs.
     */
    async list(t: TenantDb, filter: AgentListFilter): Promise<AgentView[]> {
      const rows = await repo.listAgents(t, LIST_STATUSES[filter ?? 'default']);
      const places = new Map((await repo.positions(t)).map((position) => [position.principalId, position]));
      const profileIds = rows.map((agent) => agent.profileId);
      const profiles = await profileRefs(deps, repo, t, profileIds);
      const placements = await placementsOf(t);
      return rows.map((agent) =>
        agentView(agent, places.get(agent.principalId), {
          profile: profiles.get(agent.profileId as string) ?? null,
          placement: placements.get(agent.id) ?? null,
        }),
      );
    },

    /** One agent with its instructions (archived ones too); 404 for an unknown one or another company's. */
    async get(t: TenantDb, agentId: string): Promise<AgentResult<404>> {
      const agent = await repo.getAgent(t, agentId);
      if (agent === undefined) return AGENT_NOT_FOUND;
      return shownAgent(deps, repo, t, {
        ok: true,
        agent,
        position: await repo.getPosition(t, agent.principalId),
      });
    },

    create: async (t: TenantDb, caller: Caller, input: CreateAgent) =>
      shownAgent(deps, repo, t, await createAgent(repo, t, caller, input)),
    update: async (t: TenantDb, caller: Caller, agentId: string, patch: UpdateAgent) =>
      shownAgent(deps, repo, t, await updateAgent(repo, t, caller, { agentId, patch })),
    setPosition: (t: TenantDb, caller: Caller, principalId: string, body: UpdatePosition) =>
      setPosition(repo, t, caller, { principalId, body }),
    setDefaultProfile: (t: TenantDb, caller: Caller, profileId: string | null) =>
      setDefaultProfile(repo, t, caller, profileId),
    chart: chartReader(deps, repo),
  };
}

export type OrgService = ReturnType<typeof orgService>;
