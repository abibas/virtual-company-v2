import { auditLog, tenant } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { RunnerFrame, ServerFrame } from '@mwc/shared/runner-protocol';
import { TEST_NOW } from '@mwc/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMPOSE_FILE } from '../../../../src/modules/health/service.ts';
import { machineJobs } from '../../../../src/modules/machines/service/jobs.ts';
import { updateRunner } from '../../../../src/modules/machines/service/runner/update.ts';
import { auditOf, DEVBOX, enroll, MAC, machinesPath } from '../../../fixtures/machines/machines.ts';
import { type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { addMember, as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const NEW = 'cd'.repeat(32);
const update = (company: MembersCompany, machineId: string, person = company.owner) =>
  as(w, person)('POST', machinesPath(company, `/${machineId}/runner-update`));

/** A runner's answers: `runner.update.result` as `answer` says, `cmd.ack` ok to any other command. */
const answering =
  (answer: (cmdId: string) => RunnerFrame) =>
  (frame: ServerFrame): RunnerFrame[] => {
    if (frame.type === 'runner.update') return [answer(frame.cmdId)];
    return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
  };

/** A company with a machine (This Mac unless told) whose connected runner updates itself, answering `answer`. */
async function selfUpdating(answer: (cmdId: string) => RunnerFrame, machine = MAC) {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company, machine);
  const runner = await w.connect(runnerKey, {
    build: 'ab'.repeat(32),
    caps: { selfUpdate: true, terminal: true },
    respond: answering(answer),
  });
  return { company, machineId, runner };
}

const updated = (cmdId: string): RunnerFrame => ({
  type: 'runner.update.result',
  cmdId,
  ok: true,
  build: NEW,
});

/** The machine's audit rows of runner updates, as `action field`. */
const updatesAudited = async (machineId: string) =>
  (await auditOf(w.t.db, 'machine', machineId)).filter((row) => row.startsWith('runner_update'));

/** Who updated the machine's runner and by which path, from its audit row. */
async function updateAudit(machineId: string) {
  const rows = await rawDb(w.t.db)
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, machineId),
        eq(auditLog.action, 'runner_update'),
        eq(auditLog.field, 'runnerUpdate'),
      ),
    );
  return rows.map((row) => ({ actor: row.actorPrincipalId, kind: row.actorKind, path: row.newValue }));
}

describe('POST machines/:machineId/runner-update: a runner that updates itself', () => {
  it('sends it runner.update, waits for its answer, answers 202 self_update with its new build, and audits it', async () => {
    const { company, machineId, runner } = await selfUpdating(updated);
    const res = await update(company, machineId);
    expect([res.status, res.body]).toEqual([202, { path: 'self_update', build: NEW }]);
    expect(runner.frames.of('runner.update')).toHaveLength(1);
    expect(await updatesAudited(machineId)).toEqual([
      'runner_update runnerBuild',
      'runner_update runnerUpdate',
    ]);
    expect(await updateAudit(machineId)).toEqual([
      { actor: company.owner.principalId, kind: 'user', path: 'self_update' },
    ]);
  });

  it('is for admins and owners: members and viewers get 403', async () => {
    const { company, machineId } = await selfUpdating(updated);
    const admin = await addMember(w, company, 'admin');
    expect((await update(company, machineId, admin)).status).toBe(202);
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, company, role);
      expect((await update(company, machineId, person)).status).toBe(403);
    }
  });

  it("is a 404 for another company's machine and an unknown one", async () => {
    const { machineId } = await selfUpdating(updated);
    const other = await membersCompany(w);
    expect((await update(other, machineId)).body).toMatchObject({ error: { code: 'machine_not_found' } });
    expect((await update(other, 'nope')).status).toBe(404);
  });

  it('answers 202 with no build when the runner did not say it', async () => {
    const { company, machineId } = await selfUpdating((cmdId) => ({
      type: 'runner.update.result',
      cmdId,
      ok: true,
    }));
    expect((await update(company, machineId)).body).toEqual({ path: 'self_update', build: null });
  });

  it('is a 409 runner_busy when it has live work, and a 502 update_failed with its words when it failed', async () => {
    const busy = await selfUpdating((cmdId) => ({
      type: 'runner.update.result',
      cmdId,
      ok: false,
      error: 'busy: 1 live run; update it once they end',
    }));
    expect(await update(busy.company, busy.machineId)).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'runner_busy',
          message: 'The runner is busy and kept its build: 1 live run; update it once they end',
        },
      },
    });
    const failed = await selfUpdating((cmdId) => ({
      type: 'runner.update.result',
      cmdId,
      ok: false,
      error: 'hash_mismatch: the runner does not match its SHA-256',
    }));
    expect(await update(failed.company, failed.machineId)).toMatchObject({
      status: 502,
      body: {
        error: {
          code: 'update_failed',
          message: 'The runner was not updated: the runner does not match its SHA-256',
        },
      },
    });
    expect(await updatesAudited(failed.machineId)).toEqual([]);
  });

  it('falls back to the command to run when the runner says it cannot, or acks runner.update as unknown', async () => {
    const unsupported = await selfUpdating((cmdId) => ({
      type: 'runner.update.result',
      cmdId,
      ok: false,
      error: 'unsupported: this runner is not an installed copy that launchd or systemd restarts',
    }));
    expect(await update(unsupported.company, unsupported.machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'update_unsupported' } },
    });
    const old = await selfUpdating((cmdId) => ({
      type: 'cmd.ack',
      cmdId,
      ok: false,
      error: 'unknown command runner.update',
    }));
    expect((await update(old.company, old.machineId)).body).toMatchObject({
      error: { code: 'update_unsupported' },
    });
  });
});

describe('POST machines/:machineId/runner-update: a runner that cannot update itself', () => {
  it('is a 409 machine_offline without a connected runner', async () => {
    const company = await membersCompany(w);
    const { machineId } = await enroll(w, company);
    expect(await update(company, machineId)).toMatchObject({
      status: 409,
      body: { error: { code: 'machine_offline' } },
    });
  });

  it('is a 409 update_unsupported with the command to run: This Mac, a container, a devbox without this server', async () => {
    const company = await membersCompany(w);
    const cases = [
      [
        MAC,
        'curl -fsSL http://localhost:9950/api/runner/install.sh | sh -s -- --server http://localhost:9950',
      ],
      [
        { ...MAC, kind: 'container' as const, name: 'runner-local' },
        `docker compose -p mwc-runner-runner-local -f ${COMPOSE_FILE} --profile runner up -d --build runner-local`,
      ],
      [
        DEVBOX,
        "airia devbox ssh -- -R 127.0.0.1:9954:127.0.0.1:9950 'curl -fsSL http://127.0.0.1:9954/api/runner/install.sh | sh -s -- --server http://127.0.0.1:9950 --via http://127.0.0.1:9954'",
      ],
    ] as const;
    for (const [machine, command] of cases) {
      const { machineId, runnerKey } = await enroll(w, company, machine);
      await w.connect(runnerKey);
      const res = await update(company, machineId);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'update_unsupported',
          message: expect.stringMatching(/^This runner cannot update itself from here\. Run this in /),
          requestId: expect.any(String),
          command,
        },
      });
    }
  });
});

describe('the self-update when the runner goes quiet or away', () => {
  /** A company whose machine's runner says it updates itself and never answers. */
  async function silent() {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company);
    const runner = await w.connect(runnerKey, { caps: { selfUpdate: true }, respond: () => [] });
    const t = await tenant(w.t.db, company.companyId);
    const caller = { principalId: company.owner.principalId, requestId: 'req-1' };
    return { machineId, runner, t, caller };
  }
  const deps = (timeoutMs: number) => ({
    hub: w.hub,
    control: w.control,
    jobs: machineJobs(w.clock),
    apiUrl: 'http://localhost:9950',
    apiPort: 9950,
    composeFile: null,
    timeoutMs,
  });

  it('is a 502 update_failed when it does not answer in time', async () => {
    const { machineId, t, caller } = await silent();
    expect(await updateRunner(deps(50), t, caller, machineId)).toMatchObject({
      status: 502,
      code: 'update_failed',
      message: 'The runner was not updated: it did not answer in time',
    });
  });

  it("reads a refusal without words, and passes on an error that is not the hub's", async () => {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company);
    await w.connect(runnerKey, {
      caps: { selfUpdate: true },
      respond: answering((cmdId) => ({ type: 'runner.update.result', cmdId, ok: false })),
    });
    const t = await tenant(w.t.db, company.companyId);
    const caller = { principalId: company.owner.principalId, requestId: 'req-2' };
    expect(await updateRunner(deps(5000), t, caller, machineId)).toMatchObject({
      status: 502,
      message: 'The runner was not updated: no reason given',
    });
    const broken = { ...w.hub, request: () => Promise.reject(new Error('encode failed')) };
    await expect(updateRunner({ ...deps(5000), hub: broken }, t, caller, machineId)).rejects.toThrow(
      'encode failed',
    );
  });

  it('never reinstalls a devbox whose box cannot be read while its runner is away', async () => {
    const company = await membersCompany(w);
    const { machineId } = await enroll(w, company, DEVBOX);
    const t = await tenant(w.t.db, company.companyId);
    let reinstalled = 0;
    const control = {
      ...w.control,
      resolve: async () => ({ ok: false, status: 409, code: 'no_controller', message: 'none' }) as const,
      reinstall: async () => {
        reinstalled++;
        return { ok: true } as const;
      },
    };
    const caller = { principalId: company.owner.principalId, requestId: 'req-3' };
    expect(await updateRunner({ ...deps(5000), control }, t, caller, machineId)).toMatchObject({
      status: 409,
      code: 'machine_offline',
    });
    expect(reinstalled).toBe(0);
  });

  it('is a 409 machine_offline when it went away before it answered', async () => {
    const { machineId, runner, t, caller } = await silent();
    const pending = updateRunner(deps(5000), t, caller, machineId);
    await runner.frames.next('runner.update');
    await runner.disconnect();
    expect(await pending).toMatchObject({ status: 409, code: 'machine_offline' });
  });
});
