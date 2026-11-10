import type { RunnerFrame, RunnerTools, ServerFrame } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MachineView } from '../../../../../src/modules/machines/schemas.ts';
import { enroll, MAC, machinesPath } from '../../../../fixtures/machines/machines.ts';
import { FakeRegistry } from '../../../../fixtures/machines/registry.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { as, membersCompany } from '../../../../fixtures/members/members.ts';

/** The machines API with npm answering: the runners' tools compared with npm's latest, and an install of it. */

const registry = new FakeRegistry().latest('2.1.330', '0.167.0');
let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld({}, { registryFetch: registry.fetch });
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

const TOOLS: RunnerTools = {
  claude: '2.1.330 (Claude Code)',
  codex: 'codex-cli 0.162.1',
  git: null,
  gh: null,
  docker: null,
};

const answering = (frame: ServerFrame): RunnerFrame[] => {
  if (frame.type === 'tools.install')
    return [{ type: 'tools.result', cmdId: frame.cmdId, ok: true, tools: TOOLS }];
  return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
};

describe("the machines' tools against npm's latest", () => {
  it('lists npm’s latest with when it was read, and installs exactly that version', async () => {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company, MAC);
    const runner = await w.connect(runnerKey, { caps: { tools: TOOLS }, respond: answering });
    const latest = async () =>
      ((await as(w, company.owner)('GET', machinesPath(company, `/${machineId}`))).body as MachineView).runner
        .toolsLatest;
    await eventually('npm was read', async () => (await latest()).source === 'npm');
    expect(await latest()).toEqual({
      claude: '2.1.330',
      codex: '0.167.0',
      source: 'npm',
      checkedAt: TEST_NOW,
    });
    const res = await as(w, company.owner)('POST', machinesPath(company, `/${machineId}/tools/install`), {
      tool: 'codex',
    });
    expect(res).toMatchObject({ status: 202, body: { tool: 'codex', version: '0.167.0' } });
    await eventually('the runner was asked', () => runner.frames.of('tools.install').length === 1);
    expect(runner.frames.of('tools.install')[0]).toMatchObject({ tool: 'codex', version: '0.167.0' });
  });
});
