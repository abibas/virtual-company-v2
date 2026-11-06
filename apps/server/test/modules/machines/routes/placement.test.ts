import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call } from '../../../fixtures/companies/companies.ts';
import { DEVBOX, enroll, machinesPath } from '../../../fixtures/machines/machines.ts';
import {
  onHost,
  type PlacementView,
  place,
  placementPath,
  placementsOfAgent,
  placementWorld,
} from '../../../fixtures/machines/placements.ts';
import { addMember, as, membersCompany } from '../../../fixtures/members/members.ts';
import { auditTrail, makeAgent } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

/** A placement body for a PUT, none for the others. */
const bodyFor = (method: 'GET' | 'PUT' | 'DELETE', machineId: string) =>
  method === 'PUT' ? onHost(machineId) : undefined;

describe('GET and PUT /api/companies/:companyId/agents/:agentId/placement', () => {
  it('is null until an admin places the agent, then shows the placement to viewers too, audited', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const admin = await addMember(w, company, 'admin');
    const viewer = await addMember(w, company, 'viewer');
    const path = placementPath(company, agent.id);
    expect(await as(w, viewer)('GET', path)).toMatchObject({ status: 200, body: { placement: null } });
    const res = await as(w, admin, 'req-place')(
      'PUT',
      path,
      onHost(machineId, { home: ' /Users/ihor/slop ' }),
    );
    expect(res.status).toBe(200);
    const placement = res.body as PlacementView;
    expect(placement).toEqual({
      id: placement.id,
      agentId: agent.id,
      machineId,
      machineName: 'This Mac',
      machineStatus: 'offline',
      mode: 'host',
      home: '/Users/ihor/slop',
      configDir: null,
      worktreeRoot: null,
      permissionPolicy: 'ask',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await as(w, viewer)('GET', path)).toMatchObject({ status: 200, body: { placement } });
    const trail = await auditTrail(w.t.db, 'agent_placement', placement.id);
    expect(trail.map(([action, field]) => `${action} ${field}`)).toEqual([
      'create agentId',
      'create home',
      'create machineId',
      'create mode',
      'create permissionPolicy',
    ]);
  });

  it('changes the one default placement in place, auditing only what changed', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const box = await enroll(w, company, DEVBOX);
    const first = await place(w, company, agent.id, onHost(machineId));
    const second = await place(
      w,
      company,
      agent.id,
      onHost(box.machineId, {
        mode: 'container',
        home: '/home/ihor/airia-dev',
        configDir: '/home/ihor/.claude-slop',
        worktreeRoot: '/home/ihor/airia-dev/worktrees',
        permissionPolicy: 'bypass',
      }),
    );
    expect(second).toMatchObject({
      id: first.id,
      machineId: box.machineId,
      machineName: 'Airia devbox',
      mode: 'container',
      configDir: '/home/ihor/.claude-slop',
      worktreeRoot: '/home/ihor/airia-dev/worktrees',
      permissionPolicy: 'bypass',
    });
    const cleared = await place(w, company, agent.id, onHost(box.machineId, { configDir: null }));
    expect(cleared).toMatchObject({
      mode: 'host',
      configDir: null,
      worktreeRoot: null,
      permissionPolicy: 'ask',
    });
    expect((await placementsOfAgent(w.t.db, agent.id)).map((row) => row.isDefault)).toEqual([true]);
    const updates = (await auditTrail(w.t.db, 'agent_placement', first.id)).filter(([a]) => a === 'update');
    expect(updates.map(([, field, old, now]) => [field, old, now])).toEqual([
      ['configDir', null, '/home/ihor/.claude-slop'],
      ['home', '/Users/ihor/agents/slop-box', '/home/ihor/airia-dev'],
      ['machineId', machineId, box.machineId],
      ['mode', 'host', 'container'],
      ['permissionPolicy', 'ask', 'bypass'],
      ['worktreeRoot', null, '/home/ihor/airia-dev/worktrees'],
      ['configDir', '/home/ihor/.claude-slop', null],
      ['home', '/home/ihor/airia-dev', '/Users/ihor/agents/slop-box'],
      ['mode', 'container', 'host'],
      ['permissionPolicy', 'bypass', 'ask'],
      ['worktreeRoot', '/home/ihor/airia-dev/worktrees', null],
    ]);
  });

  it('is a 401 without a credential and a 403 below admin for a change', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const path = placementPath(company, agent.id);
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      expect((await call(w, undefined)(method, path, bodyFor(method, machineId))).status).toBe(401);
    }
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, company, role);
      expect((await as(w, person)('GET', path)).status).toBe(200);
      expect(await as(w, person)('PUT', path, onHost(machineId))).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
      expect((await as(w, person)('DELETE', path)).status).toBe(403);
    }
    expect(await placementsOfAgent(w.t.db, agent.id)).toEqual([]);
  });

  it("is a 404 for a non-member, another company's agent and an unknown one", async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const other = await placementWorld(w);
    const path = placementPath(company, agent.id);
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const res = await as(w, other.company.owner)(method, path, bodyFor(method, other.machineId));
      expect(res).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    }
    for (const id of [other.agent.id, '019a5b2e-0000-7000-8000-000000000000', 'not-a-uuid']) {
      for (const method of ['GET', 'PUT', 'DELETE'] as const) {
        const res = await as(w, company.owner)(
          method,
          placementPath(company, id),
          bodyFor(method, machineId),
        );
        expect(res).toMatchObject({ status: 404, body: { error: { code: 'agent_not_found' } } });
      }
    }
    expect(await placementsOfAgent(w.t.db, other.agent.id)).toEqual([]);
  });

  it('refuses a body that does not fit (400) and a machine that is not the company’s (422)', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const other = await placementWorld(w);
    const path = placementPath(company, agent.id);
    const { mode: _mode, ...noMode } = onHost(machineId);
    for (const body of [
      noMode,
      onHost(machineId, { mode: 'vm' }),
      onHost(machineId, { permissionPolicy: 'yolo' }),
      onHost(machineId, { permissionPolicy: undefined }),
      onHost(machineId, { home: 'agents/slop-box' }),
      onHost(machineId, { home: '~/airia-dev' }),
      onHost(machineId, { home: '   ' }),
      onHost(machineId, { home: `/${'a'.repeat(500)}` }),
      onHost(machineId, { configDir: '.claude' }),
      onHost(machineId, { worktreeRoot: '' }),
      onHost(machineId, { machineId: 7 }),
    ]) {
      expect(await as(w, company.owner)('PUT', path, body)).toMatchObject({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      });
    }
    const removed = await enroll(w, company);
    expect(
      (await as(w, company.owner)('DELETE', machinesPath(company, `/${removed.machineId}`))).status,
    ).toBe(204);
    for (const id of [other.machineId, removed.machineId, '019a5b2e-0000-7000-8000-000000000000', 'nope']) {
      expect(await as(w, company.owner)('PUT', path, onHost(id))).toMatchObject({
        status: 422,
        body: { error: { code: 'machine_not_found' } },
      });
    }
    expect(await placementsOfAgent(w.t.db, agent.id)).toEqual([]);
  });

  it('places a container run on any machine, and an archived agent too', async () => {
    const company = await membersCompany(w);
    const agent = await makeAgent(w, company, company.owner, { name: 'Sleeper' });
    const { machineId } = await enroll(w, company);
    const archive = await as(w, company.owner)(
      'PATCH',
      `/api/companies/${company.companyId}/agents/${agent.id}`,
      {
        status: 'archived',
      },
    );
    expect(archive.status).toBe(200);
    expect(await place(w, company, agent.id, onHost(machineId, { mode: 'container' }))).toMatchObject({
      mode: 'container',
      machineName: 'This Mac',
    });
  });
});

describe('DELETE /api/companies/:companyId/agents/:agentId/placement', () => {
  it('removes the placement for an admin, audited, then has none to remove', async () => {
    const { company, agent, machineId } = await placementWorld(w);
    const admin = await addMember(w, company, 'admin');
    const placement = await place(w, company, agent.id, onHost(machineId));
    const path = placementPath(company, agent.id);
    expect((await as(w, admin, 'req-unplace')('DELETE', path)).status).toBe(204);
    expect(await as(w, admin)('GET', path)).toMatchObject({ status: 200, body: { placement: null } });
    expect(await placementsOfAgent(w.t.db, agent.id)).toEqual([]);
    const deletes = (await auditTrail(w.t.db, 'agent_placement', placement.id)).filter(
      ([a]) => a === 'delete',
    );
    expect(deletes.map(([, field, old, now]) => [field, old, now])).toEqual([
      ['agentId', agent.id, null],
      ['home', '/Users/ihor/agents/slop-box', null],
      ['machineId', machineId, null],
      ['mode', 'host', null],
      ['permissionPolicy', 'ask', null],
    ]);
    expect(await as(w, admin)('DELETE', path)).toMatchObject({
      status: 404,
      body: { error: { code: 'placement_not_found' } },
    });
  });
});
