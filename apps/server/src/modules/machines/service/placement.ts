import { type AgentPlacement, diffFields, type Machine, type TenantDb } from '@mwc/db';
import type { PlacementMode } from '@mwc/shared/enums';
import { placementsRepo as placements } from '../repo/placements.ts';
import { machinesRepo } from '../repo.ts';
import { type Refusal, refuse } from '../rules.ts';
import type { PlacementView, SetPlacement } from '../schemas/placement.ts';

/**
 * Agents' placements (S4.7, docs/machines.md "Placements"): an agent's default placement read, set and removed, every
 * agent's for the org module's lists and chart, the agents on each machine, and a removed machine's placements deleted
 * in its removal. Runs use them from S5.
 */

const machines = machinesRepo();

export const AGENT_NOT_FOUND = refuse(404, 'agent_not_found', 'No such agent in this company');
export const PLACEMENT_NOT_FOUND = refuse(404, 'placement_not_found', 'The agent has no placement');
export const PLACEMENT_MACHINE_NOT_FOUND = refuse(
  422,
  'machine_not_found',
  'No such machine in this company: it was never enrolled here or it was removed',
);

/** Who changes a placement: their principal and the request. */
export interface PlacementCaller {
  readonly principalId: string;
  readonly requestId: string;
}

/** Where an agent runs, as the agents list and the chart show it. */
export interface PlacementSummary {
  readonly machineId: string;
  readonly machineName: string;
  readonly mode: PlacementMode;
}

export type PlacementResult = { readonly ok: true; readonly placement: PlacementView | null };

/** A placement as the API shows it, with its machine's name and status. */
export function placementView(row: AgentPlacement, machine: Machine): PlacementView {
  return {
    id: row.id,
    agentId: row.agentId,
    machineId: row.machineId,
    machineName: machine.name,
    machineStatus: machine.status,
    mode: row.mode,
    home: row.home,
    configDir: row.configDir,
    worktreeRoot: row.worktreeRoot,
    permissionPolicy: row.permissionPolicy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The audited fields of a placement. */
const audited = (row: AgentPlacement) => ({
  agentId: row.agentId,
  machineId: row.machineId,
  mode: row.mode,
  home: row.home,
  configDir: row.configDir,
  worktreeRoot: row.worktreeRoot,
  permissionPolicy: row.permissionPolicy,
});

type Fields = ReturnType<typeof audited> | null;

/** One audit row per changed field of a placement, by the caller. */
const audit = (
  t: TenantDb,
  caller: PlacementCaller,
  row: AgentPlacement,
  action: string,
  diff: [Fields, Fields],
) =>
  machines.audit(t, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: 'agent_placement',
    entityId: row.id,
    action,
    changes: diffFields(...diff),
  });

/** The agent's default placement with its machine, or null; 404 for an unknown agent or another company's. */
export async function agentPlacement(t: TenantDb, agentId: string): Promise<PlacementResult | Refusal> {
  const agent = await placements.agentOf(t, agentId);
  if (agent === undefined) return AGENT_NOT_FOUND;
  const row = await placements.defaultOf(t, agent.id);
  const machine = row && (await machines.get(t, row.machineId));
  return { ok: true, placement: row && machine ? placementView(row, machine) : null };
}

/**
 * Sets the agent's default placement (archived agents too), under the company's lock so a machine's removal never
 * passes it: a new one is created, the one it has is changed; audited per field. The machine must be the company's
 * and not removed (422); any mode is taken on any machine for now.
 */
export function setPlacement(
  t: TenantDb,
  caller: PlacementCaller,
  agentId: string,
  body: SetPlacement,
): Promise<{ readonly ok: true; readonly placement: PlacementView } | Refusal<404 | 422>> {
  return t.transaction(async (tx) => {
    await tx.lockCompany();
    const agent = await placements.agentOf(tx, agentId);
    if (agent === undefined) return AGENT_NOT_FOUND;
    const machine = await machines.get(tx, body.machineId);
    if (machine === undefined) return PLACEMENT_MACHINE_NOT_FOUND;
    const values = {
      machineId: machine.id,
      mode: body.mode,
      home: body.home,
      configDir: body.configDir ?? null,
      worktreeRoot: body.worktreeRoot ?? null,
      permissionPolicy: body.permissionPolicy,
    };
    const before = await placements.defaultOf(tx, agent.id);
    const row =
      before === undefined
        ? await placements.insert(tx, { ...values, agentId: agent.id, isDefault: true })
        : await placements.update(tx, before.id, values);
    const action = before === undefined ? 'create' : 'update';
    await audit(tx, caller, row, action, [before === undefined ? null : audited(before), audited(row)]);
    return { ok: true as const, placement: placementView(row, machine) };
  });
}

/** Removes the agent's default placement, audited; 404 for an unknown agent or one with none. */
export function removePlacement(
  t: TenantDb,
  caller: PlacementCaller,
  agentId: string,
): Promise<{ readonly ok: true } | Refusal> {
  return t.transaction(async (tx) => {
    const agent = await placements.agentOf(tx, agentId);
    if (agent === undefined) return AGENT_NOT_FOUND;
    const row = await placements.defaultOf(tx, agent.id);
    if (row === undefined) return PLACEMENT_NOT_FOUND;
    await placements.remove(tx, row.id);
    await audit(tx, caller, row, 'delete', [audited(row), null]);
    return { ok: true as const };
  });
}

/** In a machine's removal transaction: deletes every placement on it, each audited as deleted by the remover. */
export async function removeMachinePlacements(
  tx: TenantDb,
  caller: PlacementCaller,
  machineId: string,
): Promise<void> {
  for (const row of await placements.removeForMachine(tx, machineId)) {
    await audit(tx, caller, row, 'delete', [audited(row), null]);
  }
}

/** Every agent's default placement as lists show it, by agent id (for the org module's agents and chart). */
export async function placementsOf(t: TenantDb): Promise<Map<string, PlacementSummary>> {
  const rows = await placements.defaults(t);
  if (rows.length === 0) return new Map();
  const named = new Map((await machines.list(t)).map((machine) => [machine.id, machine.name]));
  const summaries = new Map<string, PlacementSummary>();
  for (const row of rows) {
    const machineName = named.get(row.machineId);
    if (machineName !== undefined) {
      summaries.set(row.agentId, { machineId: row.machineId, machineName, mode: row.mode });
    }
  }
  return summaries;
}

/** How many agents not archived have their default placement on each machine (`agentCount`). */
export const agentCounts = (t: TenantDb): Promise<Map<string, number>> => placements.agentCounts(t);
