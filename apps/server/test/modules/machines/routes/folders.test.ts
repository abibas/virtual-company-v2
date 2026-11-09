import { tenant } from '@mwc/db';
import type { RunnerFrame, ServerFrame } from '@mwc/shared/runner-protocol';
import { FAKE_FOLDER_LIST, type FakeRunnerOptions } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listFolders, makeFolder } from '../../../../src/modules/machines/service/folders.ts';
import { auditOf, enroll, MAC, machinesPath } from '../../../fixtures/machines/machines.ts';
import { type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { addMember, as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const folders = (company: MembersCompany, machineId: string, person = company.owner) => ({
  list: (path?: string) =>
    as(w, person)(
      'GET',
      machinesPath(
        company,
        `/${machineId}/folders${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`,
      ),
    ),
  make: (path: unknown) => as(w, person)('POST', machinesPath(company, `/${machineId}/folders`), { path }),
});

/** A Mac's listing of `~/agents`. */
const MAC_LIST = (cmdId: string): RunnerFrame => ({
  type: 'fs.result',
  cmdId,
  ok: true,
  path: '/Users/ihor/agents',
  parent: '/Users/ihor',
  entries: [{ name: 'slop-box', git: true, claudeMd: true }],
  truncated: false,
  home: '/Users/ihor',
  root: null,
});

/** A runner's answers to the folder frames by `answer`, `cmd.ack` ok to the rest. */
const answering =
  (answer: (frame: ServerFrame & { cmdId: string }) => RunnerFrame[]) =>
  (frame: ServerFrame): RunnerFrame[] => {
    if (frame.type === 'fs.list' || frame.type === 'fs.mkdir') return answer(frame);
    return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
  };

/** A company with This Mac, its runner connected (browsing folders unless told) with `options`. */
async function connected(options: Omit<FakeRunnerOptions, 'url' | 'key'> = {}, machine = MAC) {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company, machine);
  const runner = await w.connect(runnerKey, { ...options, caps: { folders: true, ...options.caps } });
  return { company, machineId, runner, api: folders(company, machineId) };
}

describe('GET machines/:machineId/folders', () => {
  it('lists a folder through the runner: its folders, the home and where agents go by default', async () => {
    const { api, runner } = await connected({ respond: answering((frame) => [MAC_LIST(frame.cmdId)]) });
    const res = await api.list('~/agents');
    expect([res.status, res.body]).toEqual([
      200,
      {
        path: '/Users/ihor/agents',
        parent: '/Users/ihor',
        entries: [{ name: 'slop-box', git: true, claudeMd: true }],
        truncated: false,
        home: '/Users/ihor',
        root: null,
        agentsRoot: '/Users/ihor/agents',
      },
    ]);
    expect(runner.frames.of('fs.list').map((frame) => frame.path)).toEqual(['~/agents']);
  });

  it('asks for the default start without a path, and a Docker runner’s agents go in /work', async () => {
    const { api, runner } = await connected({}, { ...MAC, name: 'Docker runner', kind: 'container' });
    const { type: _type, ok: _ok, ...listing } = FAKE_FOLDER_LIST;
    expect((await api.list()).body).toEqual({ ...listing, agentsRoot: '/work' });
    expect(runner.frames.of('fs.list').map((frame) => frame.path)).toEqual([null]);
  });

  it('is for admins and owners: members and viewers get 403', async () => {
    const { company, machineId } = await connected();
    const admin = await addMember(w, company, 'admin');
    expect((await folders(company, machineId, admin).list()).status).toBe(200);
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, company, role);
      expect((await folders(company, machineId, person).list()).status).toBe(403);
    }
  });

  it("is a 404 for another company's machine and an unknown one, and a 400 for a relative path", async () => {
    const { machineId, api } = await connected();
    const other = await membersCompany(w);
    expect((await folders(other, machineId).list()).body).toMatchObject({
      error: { code: 'machine_not_found' },
    });
    expect((await folders(other, 'nope').list()).status).toBe(404);
    expect((await api.list('agents')).body).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('is a 409 machine_offline without a connected runner, and runner_outdated without the folder browser', async () => {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company);
    expect((await folders(company, machineId).list()).body).toMatchObject({
      error: { code: 'machine_offline' },
    });
    const runner = await w.connect(runnerKey);
    expect(await folders(company, machineId).list()).toMatchObject({
      status: 409,
      body: { error: { code: 'runner_outdated' } },
    });
    expect(runner.frames.of('fs.list')).toEqual([]);
  });

  it('is runner_outdated when a runner that said it browses acks the frame as unknown', async () => {
    const { api } = await connected({
      respond: answering((frame) => [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: false, error: 'unknown' }]),
    });
    expect((await api.list()).body).toMatchObject({ error: { code: 'runner_outdated' } });
  });

  it("passes the runner's refusals on as 422s in plain words", async () => {
    const { api } = await connected({
      respond: answering((frame) => [
        { type: 'fs.result', cmdId: frame.cmdId, ok: false, error: 'outside_volume: /etc is outside /work' },
      ]),
    });
    expect(await api.list('/etc')).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'outside_volume',
          message: 'A Docker runner keeps its folders in its work volume, /work (/etc is outside /work)',
        },
      },
    });
  });

  it('is a 409 machine_offline when the runner disconnects before it answers', async () => {
    let runner: Awaited<ReturnType<typeof connected>>['runner'] | undefined;
    const setup = await connected({
      respond: () => {
        void runner?.disconnect();
        return [];
      },
    });
    runner = setup.runner;
    expect((await setup.api.list()).body).toMatchObject({ error: { code: 'machine_offline' } });
  });
});

describe('POST machines/:machineId/folders', () => {
  it('makes the folder through the runner, answers 201 with its path, and audits it', async () => {
    const { company, machineId, api, runner } = await connected();
    const res = await api.make('/Users/ihor/agents/scout');
    expect([res.status, res.body]).toEqual([201, { path: '/Users/ihor/agents/scout' }]);
    expect(runner.frames.of('fs.mkdir').map((frame) => frame.path)).toEqual(['/Users/ihor/agents/scout']);
    expect(await auditOf(w.t.db, 'machine', machineId)).toContain('folder_create folder');
    expect(company.owner.principalId).toBeDefined();
  });

  it('refuses a relative path, a member, a folder already there and an old runner', async () => {
    const { company, machineId, api } = await connected({
      respond: answering((frame) => [
        { type: 'fs.result', cmdId: frame.cmdId, ok: false, error: 'exists: /Users/ihor/agents' },
      ]),
    });
    expect((await api.make('agents')).status).toBe(400);
    expect((await api.make(undefined)).status).toBe(400);
    const member = await addMember(w, company, 'member');
    expect((await folders(company, machineId, member).make('/a')).status).toBe(403);
    expect(await api.make('/Users/ihor/agents')).toMatchObject({
      status: 422,
      body: { error: { code: 'folder_exists', message: '/Users/ihor/agents is there already' } },
    });
    expect(await auditOf(w.t.db, 'machine', machineId)).not.toContain('folder_create folder');
    const old = await membersCompany(w);
    const { machineId: oldId, runnerKey } = await enroll(w, old);
    await w.connect(runnerKey);
    expect((await folders(old, oldId).make('/a')).body).toMatchObject({ error: { code: 'runner_outdated' } });
  });
});

describe('the folders service', () => {
  it('is a 504 runner_timeout when the runner does not answer in time, and passes on an error that is not the hub’s', async () => {
    const { company, machineId } = await connected({ respond: () => [] });
    const t = await tenant(w.t.db, company.companyId);
    expect(await listFolders({ hub: w.hub, timeoutMs: 50 }, t, machineId, null)).toMatchObject({
      status: 504,
      code: 'runner_timeout',
      message: "The machine's runner did not answer within 10 seconds",
    });
    const broken = { ...w.hub, request: () => Promise.reject(new Error('encode failed')) };
    await expect(listFolders({ hub: broken }, t, machineId, null)).rejects.toThrow('encode failed');
    const caller = { principalId: company.owner.principalId, requestId: 'req-1' };
    expect(await makeFolder({ hub: w.hub, timeoutMs: 50 }, t, caller, machineId, '/a')).toMatchObject({
      code: 'runner_timeout',
    });
  });

  it('takes the asked path when the runner made the folder without saying where', async () => {
    const { company, machineId } = await connected({
      respond: answering((frame) => [{ type: 'fs.result', cmdId: frame.cmdId, ok: true }]),
    });
    const t = await tenant(w.t.db, company.companyId);
    const caller = { principalId: company.owner.principalId, requestId: 'req-2' };
    expect(await makeFolder({ hub: w.hub }, t, caller, machineId, '/w/a')).toEqual({
      ok: true,
      path: '/w/a',
    });
  });
});
