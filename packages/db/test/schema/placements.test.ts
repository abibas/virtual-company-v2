import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Agent,
  type AgentPlacement,
  agentPlacements,
  type Company,
  type Machine,
  type NewAgentPlacement,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertAgent, insertCompany, insertMachine, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let mac: Machine;

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  mac = await insertMachine(handle, acme.id);
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

/** A placement of `agent` on This Mac in its folder, unless `values` say otherwise. */
async function insertPlacement(
  agent: Agent,
  values: Partial<NewAgentPlacement> = {},
): Promise<AgentPlacement> {
  const [row] = await handle.db
    .insert(agentPlacements)
    .values({
      companyId: agent.companyId,
      agentId: agent.id,
      machineId: mac.id,
      mode: 'host',
      home: '/Users/ihor/agents/slop-box',
      ...values,
    })
    .returning();
  if (!row) throw new Error('no placement returned');
  return row;
}

describe('agent_placements', () => {
  it('stores a default placement that asks, with no configuration folder or worktree root', async () => {
    const agent = await insertAgent(handle, acme.id);
    expect(await insertPlacement(agent)).toMatchObject({
      mode: 'host',
      home: '/Users/ihor/agents/slop-box',
      configDir: null,
      worktreeRoot: null,
      permissionPolicy: 'ask',
      isDefault: true,
    });
    const box = await insertPlacement(await insertAgent(handle, acme.id), {
      mode: 'container',
      configDir: '/home/ihor/.claude-slop',
      worktreeRoot: '/home/ihor/airia-dev/worktrees',
      permissionPolicy: 'bypass',
    });
    expect(box).toMatchObject({ mode: 'container', permissionPolicy: 'bypass' });
  });

  it('keeps at most one default per agent, and any number of others', async () => {
    const agent = await insertAgent(handle, acme.id);
    await insertPlacement(agent);
    expect(await constraint(insertPlacement(agent))).toBe('agent_placements_one_default_idx');
    await insertPlacement(agent, { isDefault: false });
    await insertPlacement(agent, { isDefault: false, home: '/tmp/other' });
    const rows = await handle.db.select().from(agentPlacements).where(eq(agentPlacements.agentId, agent.id));
    expect(rows.map((row) => row.isDefault).sort()).toEqual([false, false, true]);
  });

  it('refuses a bad mode, policy or folder', async () => {
    const agent = await insertAgent(handle, acme.id);
    const bad = (values: Partial<NewAgentPlacement>) =>
      constraint(insertPlacement(agent, { isDefault: false, ...values }));
    // @ts-expect-error mode is typed as PlacementMode; the database refuses it as well
    expect(await bad({ mode: 'vm' })).toBe('agent_placements_mode_check');
    // @ts-expect-error permissionPolicy is typed as PermissionPolicy
    expect(await bad({ permissionPolicy: 'yolo' })).toBe('agent_placements_permission_policy_check');
    for (const home of ['', 'relative/path', '~/airia-dev', `/${'a'.repeat(500)}`]) {
      expect(await bad({ home })).toBe('agent_placements_home_check');
    }
    expect(await bad({ configDir: '.claude' })).toBe('agent_placements_config_dir_check');
    expect(await bad({ worktreeRoot: '' })).toBe('agent_placements_worktree_root_check');
  });

  it("refuses another company's agent or machine, and unknown ones", async () => {
    const agent = await insertAgent(handle, acme.id);
    const theirAgent = await insertAgent(handle, globex.id);
    const theirMachine = await insertMachine(handle, globex.id);
    expect(await constraint(insertPlacement(agent, { machineId: theirMachine.id }))).toBe(
      'agent_placements_machine_fk',
    );
    expect(await constraint(insertPlacement(agent, { machineId: MISSING_ID }))).toBe(
      'agent_placements_machine_fk',
    );
    expect(await constraint(insertPlacement(theirAgent))).toBe('agent_placements_machine_fk');
    expect(await constraint(insertPlacement(agent, { agentId: theirAgent.id }))).toBe(
      'agent_placements_agent_fk',
    );
  });
});
