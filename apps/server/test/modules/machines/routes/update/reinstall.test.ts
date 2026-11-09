import { auditLog } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { captureLogger, TEST_NOW, testConfig } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { localPowerFromConfig } from '../../../../../src/platform/power/local.ts';
import { DEVBOX, enroll, MAC, machinesPath } from '../../../../fixtures/machines/machines.ts';
import { GCLOUD, reinstallComputer } from '../../../../fixtures/machines/reinstall.ts';
import { type MachinesWorld, machinesWorld } from '../../../../fixtures/machines/world.ts';
import { as, type MembersCompany, membersCompany } from '../../../../fixtures/members/members.ts';

/** The server drives the airia CLI itself (MWC_LOCAL_POWER), on a computer whose processes are fakes. */
let w: MachinesWorld;
let computer: ReturnType<typeof reinstallComputer>;
beforeAll(async () => {
  computer = reinstallComputer();
  const config = { ...testConfig, MWC_LOCAL_POWER: 'on' as const };
  const local = localPowerFromConfig(config, captureLogger().logger, computer.host);
  if (local === undefined) throw new Error('the fake computer has the airia CLI and gcloud');
  w = await machinesWorld({}, { local });
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
  computer.setStatus('RUNNING');
  computer.endWith({ code: 0 });
});
afterAll(() => w.close());

const update = (company: MembersCompany, machineId: string) =>
  as(w, company.owner)('POST', machinesPath(company, `/${machineId}/runner-update`));

/** A company with its devbox, whose runner is connected unless told (one older than the self-update by default). */
async function devbox(connect: 'old' | 'none' = 'old') {
  const company = await membersCompany(w);
  const box = await enroll(w, company, DEVBOX);
  if (connect === 'old') await w.connect(box.runnerKey);
  return { company, machineId: box.machineId };
}

describe('POST runner-update: this server reinstalls an old devbox runner over SSH', () => {
  it('runs gcloud compute ssh over IAP with the install forward and install.sh without a token, then 202', async () => {
    const { company, machineId } = await devbox();
    const before = computer.reinstalls().length;
    const res = await update(company, machineId);
    expect([res.status, res.body]).toEqual([202, { path: 'ssh_reinstall', build: null }]);
    const [reinstall] = computer.reinstalls().slice(before);
    expect(reinstall?.file).toBe(GCLOUD);
    expect(reinstall?.args).toEqual([
      'compute',
      'ssh',
      'dev-ihorherasko',
      '--project',
      'airia-devbox',
      '--zone',
      'europe-west1-b',
      '--tunnel-through-iap',
      '--quiet',
      '--',
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      '127.0.0.1:9954:127.0.0.1:9950',
      'curl -fsSL http://127.0.0.1:9954/api/runner/install.sh | sh -s -- --server http://127.0.0.1:9950 --via http://127.0.0.1:9954',
    ]);
    expect(reinstall?.options).toMatchObject({ stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    const rows = await rawDb(w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, machineId), eq(auditLog.action, 'runner_update')));
    expect(rows.map((row) => [row.actorPrincipalId, row.field, row.newValue])).toEqual([
      [company.owner.principalId, 'runnerUpdate', 'ssh_reinstall'],
    ]);
  });

  it('reinstalls a runner that is not connected while the box runs, and never starts a stopped box', async () => {
    const running = await devbox('none');
    const before = computer.reinstalls().length;
    expect((await update(running.company, running.machineId)).body).toEqual({
      path: 'ssh_reinstall',
      build: null,
    });
    expect(computer.reinstalls()).toHaveLength(before + 1);
    computer.setStatus('TERMINATED');
    const stopped = await devbox('none');
    expect(await update(stopped.company, stopped.machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'machine_offline' } },
    });
    expect(computer.reinstalls()).toHaveLength(before + 1);
  });

  it("is a 502 update_failed with the reinstall's last line when it fails", async () => {
    const { company, machineId } = await devbox();
    computer.endWith({ code: 1, stderr: 'curl ok\nmwc-runner install: Node.js 22 or newer is needed\n' });
    expect(await update(company, machineId)).toMatchObject({
      status: 502,
      body: {
        error: {
          code: 'update_failed',
          message: 'The runner was not updated: mwc-runner install: Node.js 22 or newer is needed',
        },
      },
    });
  });

  it('lets a devbox runner that updates itself do it, and reinstalls one that says it cannot', async () => {
    const company = await membersCompany(w);
    const box = await enroll(w, company, DEVBOX);
    const before = computer.reinstalls().length;
    await w.connect(box.runnerKey, { caps: { selfUpdate: true } });
    expect((await update(company, box.machineId)).body).toEqual({ path: 'self_update', build: null });
    expect(computer.reinstalls()).toHaveLength(before);
    await w.disconnectAll();
    await w.connect(box.runnerKey, {
      caps: { selfUpdate: true },
      respond: (frame) =>
        frame.type === 'runner.update'
          ? [
              {
                type: 'runner.update.result',
                cmdId: frame.cmdId,
                ok: false,
                error: 'unsupported: no service',
              },
            ]
          : [],
    });
    expect((await update(company, box.machineId)).body).toEqual({ path: 'ssh_reinstall', build: null });
  });

  it('still names the command for a machine that is not a devbox', async () => {
    const company = await membersCompany(w);
    const mac = await enroll(w, company, MAC);
    await w.connect(mac.runnerKey);
    expect((await update(company, mac.machineId)).body).toMatchObject({
      error: { code: 'update_unsupported', command: expect.stringContaining('install.sh') },
    });
  });
});
