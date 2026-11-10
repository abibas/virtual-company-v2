import { tenant } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import type { RunnerTools } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { toolInstalls } from '../../../../src/modules/machines/service/tools/installs.ts';
import { checkTools, installStatus, startInstall } from '../../../../src/modules/machines/service/tools.ts';
import { auditOf, enroll } from '../../../fixtures/machines/machines.ts';
import { type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { membersCompany } from '../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const TOOLS: RunnerTools = { claude: null, codex: null, git: null, gh: null, docker: null };

/** A company's This Mac with a connected runner that has the tools and answers nothing. */
async function silent() {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company);
  await w.connect(runnerKey, { caps: { tools: TOOLS }, respond: () => [] });
  const t = await tenant(w.t.db, company.companyId);
  const deps = { hub: w.hub, installs: toolInstalls(w.clock), logger: w.deps.logger };
  return { company, machineId, t, deps };
}

describe('the tools service', () => {
  it('is a 504 runner_timeout when a check is not answered in time, and passes on an error that is not the hub’s', async () => {
    const { machineId, t, deps } = await silent();
    expect(await checkTools({ ...deps, checkTimeoutMs: 50 }, t, machineId)).toMatchObject({
      status: 504,
      code: 'runner_timeout',
      message: "The machine's runner did not answer within 45 seconds",
    });
    const broken = { ...deps, hub: { ...w.hub, request: () => Promise.reject(new Error('encode failed')) } };
    await expect(checkTools(broken, t, machineId)).rejects.toThrow('encode failed');
  });

  it('ends an install the runner does not answer in time as a timeout, and logs an audit row it cannot write', async () => {
    const { company, machineId, t, deps } = await silent();
    const caller = { principalId: company.owner.principalId, requestId: 'req-1' };
    const started = await startInstall({ ...deps, installTimeoutMs: 50 }, t, caller, {
      machineId,
      tool: 'claude',
    });
    if (!started.ok) throw new Error('not started');
    await started.ended;
    expect(installStatus(deps, t, machineId, started.install.id)).toMatchObject({
      ok: true,
      install: { status: 'failed', error: 'timeout: the runner did not answer in time', version: '2.1.308' },
    });
    // A caller who is no principal of the company: its audit row cannot be written, and the install still ends.
    const stranger = { principalId: newId(), requestId: 'req-2' };
    const second = await startInstall({ ...deps, installTimeoutMs: 50 }, t, stranger, {
      machineId,
      tool: 'codex',
    });
    if (!second.ok) throw new Error('not started');
    await second.ended;
    expect(second.install.status).toBe('failed');
    expect(w.logs.some((line) => line.msg === 'tools: could not audit an install')).toBe(true);
    expect(
      (await auditOf(w.t.db, 'machine', machineId)).filter((row) => row.startsWith('tool_install')),
    ).toHaveLength(4);
  });
});
