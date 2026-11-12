import { type Machine, tenant } from '@mwc/db';
import { COMPOSE_FILE_RELATIVE } from '@mwc/shared/container-runner';
import { testConfig } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPOSE_FILE } from '../../../../../src/modules/health/service.ts';
import { machinesRepo } from '../../../../../src/modules/machines/repo.ts';
import { machinePowerRuntime } from '../../../../../src/modules/machines/service/power/runtime.ts';
import { enroll, MAC } from '../../../../fixtures/machines/machines.ts';
import { type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { membersCompany } from '../../../../fixtures/members/members.ts';

/** The power runtime the app shares: its containers name this server's compose file, but in production. */

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterAll(() => w.close());

describe('machinePowerRuntime', () => {
  it('names this server’s compose file in a container’s commands, and the repository’s in production', async () => {
    const company = await membersCompany(w);
    const { machineId } = await enroll(w, company, { ...MAC, name: 'Docker runner', kind: 'container' });
    const machine = (await machinesRepo().get(await tenant(w.t.db, company.companyId), machineId)) as Machine;
    const deps = { ...w.deps, clock: w.clock, hub: w.hub, control: w.control };
    const here = machinePowerRuntime(deps);
    expect((await here.containers.view(machine)).commands.start).toContain(` -f ${COMPOSE_FILE} `);
    const production = machinePowerRuntime({ ...deps, config: { ...testConfig, NODE_ENV: 'production' } });
    expect((await production.containers.view(machine)).commands.start).toContain(
      ` -f ${COMPOSE_FILE_RELATIVE} `,
    );
  });
});
