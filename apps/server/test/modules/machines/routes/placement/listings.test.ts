import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MachineStatsListView } from '../../../../../src/modules/machines/schemas/stats.ts';
import type { MachineView } from '../../../../../src/modules/machines/schemas.ts';
import { auditOf, DEVBOX, enroll, machinesPath } from '../../../../fixtures/machines/machines.ts';
import {
  onHost,
  place,
  placementPath,
  placementsOfAgent,
  placementWorld,
} from '../../../../fixtures/machines/placements.ts';
import { addMember, as } from '../../../../fixtures/members/members.ts';
import { type AgentDetailView, agentsPath, chartOf, makeAgent } from '../../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const agentsOf = (body: unknown) => (body as { agents: AgentDetailView[] }).agents;
const machinesOf = (body: unknown) => (body as { machines: MachineView[] }).machines;

/** Each machine's `agentCount` in `GET machines`, `GET machines/:id` and `GET machines/stats`, by name. */
async function agentCounts(company: Parameters<typeof machinesPath>[0], owner: Parameters<typeof as>[1]) {
  const list = machinesOf((await as(w, owner)('GET', machinesPath(company))).body);
  const one = await Promise.all(
    list.map(async (m) => (await as(w, owner)('GET', machinesPath(company, `/${m.id}`))).body as MachineView),
  );
  const stats = (await as(w, owner)('GET', machinesPath(company, '/stats'))).body as MachineStatsListView;
  const byName = (rows: ReadonlyArray<{ name: string; agentCount: number }>) =>
    Object.fromEntries(rows.map((row) => [row.name, row.agentCount]));
  return { list: byName(list), one: byName(one), stats: byName(stats.machines) };
}

describe('where agents run, in the agents list, an agent, the chart and the machines', () => {
  it('shows each agent’s machine and mode, null for an agent placed nowhere', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const idle = await makeAgent(w, company, company.owner, { name: 'Idle' });
    const viewer = await addMember(w, company, 'viewer');
    await place(w, company, agent.id, onHost(machineId, { mode: 'container' }));
    const summary = { machineId, machineName: 'This Mac', mode: 'container' };
    const listed = agentsOf((await as(w, viewer)('GET', agentsPath(company))).body);
    expect(listed.map((row) => [row.id, row.placement])).toEqual([
      [agent.id, summary],
      [idle.id, null],
    ]);
    expect((await as(w, viewer)('GET', agentsPath(company, agent.id))).body).toMatchObject({
      placement: summary,
    });
    const nodes = (await chartOf(w, company)).nodes.flatMap((node) =>
      node.kind === 'agent' ? [node.agent] : [],
    );
    expect(nodes.map((node) => [node.agentId, node.placement])).toEqual([
      [agent.id, summary],
      [idle.id, null],
    ]);
    const renamed = await as(w, company.owner)('PATCH', agentsPath(company, agent.id), {
      name: 'SLOP BOX 2',
    });
    expect(renamed.body).toMatchObject({ placement: summary });
  });

  it('counts the agents on each machine, leaving archived ones out while they keep their placement', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const box = await enroll(w, company, DEVBOX);
    const second = await makeAgent(w, company, company.owner, { name: 'Reviewer' });
    const third = await makeAgent(w, company, company.owner, { name: 'QA' });
    expect(await agentCounts(company, company.owner)).toEqual({
      list: { 'Airia devbox': 0, 'This Mac': 0 },
      one: { 'Airia devbox': 0, 'This Mac': 0 },
      stats: { 'Airia devbox': 0, 'This Mac': 0 },
    });
    await place(w, company, agent.id, onHost(machineId));
    await place(w, company, second.id, onHost(machineId));
    await place(w, company, third.id, onHost(box.machineId));
    const counted = { 'Airia devbox': 1, 'This Mac': 2 };
    expect(await agentCounts(company, company.owner)).toEqual({
      list: counted,
      one: counted,
      stats: counted,
    });
    const archived = await as(w, company.owner)('PATCH', agentsPath(company, second.id), {
      status: 'archived',
    });
    expect(archived.body).toMatchObject({ status: 'archived', placement: { machineId, mode: 'host' } });
    const left = { 'Airia devbox': 1, 'This Mac': 1 };
    expect(await agentCounts(company, company.owner)).toEqual({ list: left, one: left, stats: left });
    expect((await as(w, company.owner)('GET', placementPath(company, second.id))).body).toMatchObject({
      placement: { agentId: second.id, machineId, machineName: 'This Mac' },
    });
    const all = agentsOf(
      (await as(w, company.owner)('GET', agentsPath(company, undefined, '?status=archived'))).body,
    );
    expect(all.map((row) => [row.id, row.placement?.machineId])).toEqual([[second.id, machineId]]);
    const renamed = await as(w, company.owner)('PATCH', machinesPath(company, `/${machineId}`), {
      name: 'Mac',
    });
    expect(renamed.body).toMatchObject({ name: 'Mac', agentCount: 1 });
    expect((await as(w, company.owner)('GET', placementPath(company, agent.id))).body).toMatchObject({
      placement: { machineName: 'Mac' },
    });
  });

  it('deletes the placements on a machine when it is removed, audited as the remover’s', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const box = await enroll(w, company, DEVBOX);
    const other = await makeAgent(w, company, company.owner, { name: 'Elsewhere' });
    const placement = await place(w, company, agent.id, onHost(machineId));
    await place(w, company, other.id, onHost(box.machineId));
    const admin = await addMember(w, company, 'admin');
    const removed = await as(w, admin, 'req-remove')('DELETE', machinesPath(company, `/${machineId}`));
    expect(removed.status).toBe(204);
    expect(await placementsOfAgent(w.t.db, agent.id)).toEqual([]);
    expect((await as(w, company.owner)('GET', placementPath(company, agent.id))).body).toEqual({
      placement: null,
    });
    expect(await auditOf(w.t.db, 'agent_placement', placement.id)).toEqual([
      'create agentId',
      'create home',
      'create machineId',
      'create mode',
      'delete agentId',
      'delete home',
      'delete machineId',
      'delete mode',
    ]);
    const listed = agentsOf((await as(w, company.owner)('GET', agentsPath(company))).body);
    expect(listed.map((row) => [row.id, row.placement?.machineName ?? null])).toEqual([
      [agent.id, null],
      [other.id, 'Airia devbox'],
    ]);
    expect(await agentCounts(company, company.owner)).toEqual({
      list: { 'Airia devbox': 1 },
      one: { 'Airia devbox': 1 },
      stats: { 'Airia devbox': 1 },
    });
  });
});
