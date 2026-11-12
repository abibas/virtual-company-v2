import type { DbHandle, Flow, TenantDb } from '@mwc/db';
import type { RoomAgentName } from '@mwc/shared/flows';
import type { TeamChats } from '../../../chats/index.ts';
import { orgOf, principalNames } from '../../../org/index.ts';
import type { TasksRepo } from '../../repo.ts';
import { type RoomMembers, roomMembers } from '../../rules/room.ts';
import { inOrder } from '../../rules.ts';
import type { Names } from '../team.ts';

/**
 * Who is in a flow's team room now (docs/processes.md "The team room"): its agents and its people from the chart and the
 * flow's steps (`roomMembers`), with their names and those of anyone else the caller wants named.
 */

/** What the room needs: the database (names) and the chats' side of the agents' room turns (none: nobody is asked). */
export interface RoomDeps {
  readonly db: DbHandle;
  readonly team?: TeamChats | undefined;
}

/** A room as it stands: the flow, its members, their names, and its agents as an "@" names them. */
export interface RoomContext {
  readonly flow: Flow;
  readonly members: RoomMembers;
  readonly names: Names;
  readonly agents: readonly RoomAgentName[];
}

/** The room of the flow now, naming its members and `others` (authors, the caller). Outside any transaction. */
export async function roomContext(
  deps: Pick<RoomDeps, 'db'>,
  repo: TasksRepo,
  t: TenantDb,
  flow: Flow,
  others: Iterable<string | null> = [],
): Promise<RoomContext> {
  const org = await orgOf(t);
  const steps = inOrder(await repo.flows.steps(t, flow.id));
  const members = roomMembers(
    org.chart,
    flow.leadPrincipalId,
    steps.map((step) => step.assigneePrincipalId),
  );
  const names = await principalNames(deps.db, t, [
    flow.leadPrincipalId,
    ...members.agents,
    ...members.people,
    ...others,
  ]);
  const agents = members.agents.map((principalId) => {
    const { name, slug } = names(principalId);
    return { principalId, name, slug };
  });
  return { flow, members, names, agents };
}
