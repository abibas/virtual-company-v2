import type { RunnerFrame, RunnerTools, ServerFrame } from '@mwc/shared/runner-protocol';
import type { FakeRunnerOptions } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CONTAINER_OUTDATED } from '../../../../src/modules/machines/rules/tools.ts';
import type { ToolInstallView } from '../../../../src/modules/machines/schemas/tools.ts';
import type { MachineView } from '../../../../src/modules/machines/schemas.ts';
import { auditOf, enroll, MAC, machinesPath } from '../../../fixtures/machines/machines.ts';
import { eventually, type MachinesWorld, machinesWorld } from '../../../fixtures/machines/world.ts';
import { addMember, as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import type { Person } from '../../../fixtures/platform/auth.ts';

let w: MachinesWorld;
beforeAll(async () => {
  w = await machinesWorld();
});
afterEach(() => w.disconnectAll());
afterAll(() => w.close());

const TOOLS: RunnerTools = {
  claude: '2.1.319 (Claude Code)',
  codex: null,
  git: 'git version 2.39.5',
  gh: null,
  docker: null,
};
const WITH_CODEX: RunnerTools = { ...TOOLS, codex: 'codex-cli 0.163.0' };

const tools = (company: MembersCompany, machineId: string, person: Person = company.owner) => ({
  check: () => as(w, person)('POST', machinesPath(company, `/${machineId}/tools/check`)),
  install: (tool: unknown) =>
    as(w, person)('POST', machinesPath(company, `/${machineId}/tools/install`), { tool }),
  status: (installId: string, from?: number) =>
    as(w, person)(
      'GET',
      machinesPath(
        company,
        `/${machineId}/tools/install/${installId}${from === undefined ? '' : `?from=${from}`}`,
      ),
    ),
});

/** A runner's answers to the tools frames by `answer`, `cmd.ack` ok to the rest. */
const answering =
  (answer: (frame: Extract<ServerFrame, { type: 'tools.check' | 'tools.install' }>) => RunnerFrame[]) =>
  (frame: ServerFrame): RunnerFrame[] => {
    if (frame.type === 'tools.check' || frame.type === 'tools.install') return answer(frame);
    return 'cmdId' in frame ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: true }] : [];
  };

/** A company with a machine (This Mac unless told), its runner connected with its tools (unless told). */
async function connected(options: Omit<FakeRunnerOptions, 'url' | 'key'> = {}, machine = MAC) {
  const company = await membersCompany(w);
  const { machineId, runnerKey } = await enroll(w, company, machine);
  const runner = await w.connect(runnerKey, { ...options, caps: { tools: TOOLS, ...options.caps } });
  return { company, machineId, runner, api: tools(company, machineId) };
}

/** The install, read until it ended. */
async function ended(api: ReturnType<typeof tools>, installId: string): Promise<ToolInstallView> {
  let last: ToolInstallView | undefined;
  await eventually('the install ended', async () => {
    last = (await api.status(installId)).body as ToolInstallView;
    return last.status !== 'running';
  });
  return last as ToolInstallView;
}

describe('POST machines/:machineId/tools/check', () => {
  it('has the runner look again: the tools, and the machines list follows its runner.caps at once', async () => {
    const { company, machineId, api, runner } = await connected({
      respond: answering((frame) => [
        { type: 'runner.caps', caps: { ...runner.hello.caps, tools: WITH_CODEX } },
        {
          type: 'tools.result',
          cmdId: frame.cmdId,
          ok: true,
          tools: { ...WITH_CODEX, bun: '1.3.0' } as RunnerTools,
        },
      ]),
    });
    expect(await api.check()).toMatchObject({ status: 200, body: { tools: WITH_CODEX } });
    expect(runner.frames.of('tools.check')).toHaveLength(1);
    const one = await as(w, company.owner)('GET', machinesPath(company, `/${machineId}`));
    expect((one.body as MachineView).runner.tools).toEqual(WITH_CODEX);
  });

  it('is for admins and owners, and a 404 for another company’s machine or an unknown one', async () => {
    const { company, machineId } = await connected();
    const admin = await addMember(w, company, 'admin');
    expect((await tools(company, machineId, admin).check()).status).toBe(200);
    for (const role of ['member', 'viewer'] as const) {
      expect((await tools(company, machineId, await addMember(w, company, role)).check()).status).toBe(403);
    }
    const other = await membersCompany(w);
    expect((await tools(other, machineId).check()).body).toMatchObject({
      error: { code: 'machine_not_found' },
    });
    expect((await tools(company, 'nope').check()).status).toBe(404);
  });

  it('is machine_offline without a runner, runner_outdated from one older than the tools or one that refuses', async () => {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company);
    expect((await tools(company, machineId).check()).body).toMatchObject({
      error: { code: 'machine_offline' },
    });
    const old = await w.connect(runnerKey);
    expect(await tools(company, machineId).check()).toMatchObject({
      status: 409,
      body: { error: { code: 'runner_outdated' } },
    });
    expect(old.frames.of('tools.check')).toEqual([]);
    const acks = await connected({
      respond: answering((frame) => [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: false, error: 'unknown' }]),
    });
    expect((await acks.api.check()).body).toMatchObject({ error: { code: 'runner_outdated' } });
    const refuses = await connected({
      respond: answering((frame) => [
        { type: 'tools.result', cmdId: frame.cmdId, ok: false, error: 'unsupported: no' },
      ]),
    });
    expect((await refuses.api.check()).body).toMatchObject({ error: { code: 'runner_outdated' } });
  });
});

describe('POST machines/:machineId/tools/install', () => {
  it('starts the pinned install at once (npm unreachable), streams its output, ends with the tools read again, and audits it', async () => {
    const { company, machineId, api, runner } = await connected({
      respond: answering((frame) => [
        { type: 'tools.output', cmdId: frame.cmdId, line: 'added 1 package in 3s' },
        { type: 'tools.output', cmdId: frame.cmdId, line: 'done' },
        { type: 'runner.caps', caps: { ...runner.hello.caps, tools: WITH_CODEX } },
        { type: 'tools.result', cmdId: frame.cmdId, ok: true, tools: WITH_CODEX },
      ]),
    });
    const res = await api.install('codex');
    expect(res.status).toBe(202);
    const { installId } = res.body as { installId: string };
    expect(res.body).toEqual({ installId, tool: 'codex', version: '0.163.0' });
    const install = await ended(api, installId);
    expect(install).toMatchObject({
      id: installId,
      tool: 'codex',
      version: '0.163.0',
      status: 'succeeded',
      lines: ['added 1 package in 3s', 'done'],
      next: 2,
      tools: WITH_CODEX,
      error: null,
    });
    expect(install.finishedAt).not.toBeNull();
    expect((await api.status(installId, 1)).body).toMatchObject({ lines: ['done'], next: 2 });
    expect(runner.frames.of('tools.install')).toEqual([
      { type: 'tools.install', cmdId: installId, tool: 'codex', version: '0.163.0' },
    ]);
    const audit = await auditOf(w.t.db, 'machine', machineId);
    expect(audit.filter((row) => row.startsWith('tool_install'))).toEqual([
      'tool_install result',
      'tool_install tool',
      'tool_install toolVersion',
    ]);
    expect(company.owner.principalId).toBeDefined();
  });

  it('ends failed with the runner’s words, or as outdated when the runner acks it unknown', async () => {
    const { machineId, api } = await connected({
      respond: answering((frame) =>
        frame.type === 'tools.install' && frame.tool === 'claude'
          ? [{ type: 'cmd.ack', cmdId: frame.cmdId, ok: false, error: 'unknown command' }]
          : [
              {
                type: 'tools.result',
                cmdId: frame.cmdId,
                ok: false,
                tools: TOOLS,
                error: 'npm_missing: no npm',
              },
            ],
      ),
    });
    const failed = await ended(api, ((await api.install('codex')).body as { installId: string }).installId);
    expect(failed).toMatchObject({ status: 'failed', tools: TOOLS, error: 'npm_missing: no npm' });
    expect(await auditOf(w.t.db, 'machine', machineId)).toContain('tool_install error');
    const old = await ended(api, ((await api.install('claude')).body as { installId: string }).installId);
    expect(old).toMatchObject({
      status: 'failed',
      tools: null,
      error: expect.stringMatching(/^runner_outdated: /),
    });
  });

  it('is machine_busy while one runs, naming it, then takes the next once it ended', async () => {
    const { api, runner } = await connected({ respond: answering(() => []) });
    const first = ((await api.install('claude')).body as { installId: string }).installId;
    expect(await api.install('codex')).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'machine_busy',
          message: 'Claude Code 2.1.308 is being installed: wait for it to finish',
        },
      },
    });
    expect((await api.status(first)).body).toMatchObject({ status: 'running', lines: [] });
    runner.send({ type: 'tools.result', cmdId: first, ok: true, tools: TOOLS });
    expect((await ended(api, first)).status).toBe('succeeded');
    expect((await api.install('codex')).status).toBe(202);
  });

  it('ends as machine_offline when the runner goes away during it', async () => {
    const { api, runner } = await connected({ respond: answering(() => []) });
    const installId = ((await api.install('codex')).body as { installId: string }).installId;
    await runner.disconnect();
    expect(await ended(api, installId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/^machine_offline/),
    });
  });

  it('installs in a container too, and tells a container runner older than that to update the container', async () => {
    const container = { ...MAC, name: 'Docker runner', kind: 'container' as const };
    const box = await connected({}, container);
    const started = (await box.api.install('codex')).body as { installId: string };
    expect((await ended(box.api, started.installId)).status).toBe('succeeded');
    const refusing = answering((frame) => [
      {
        type: 'tools.result',
        cmdId: frame.cmdId,
        ok: false,
        error: 'unsupported: a container gets its CLIs from its image; rebuild the image instead',
      },
    ]);
    const old = await connected({ respond: refusing }, container);
    const refused = (await old.api.install('codex')).body as { installId: string };
    expect(await ended(old.api, refused.installId)).toMatchObject({
      status: 'failed',
      error: CONTAINER_OUTDATED,
    });
    const mac = await connected({ respond: refusing });
    const kept = (await mac.api.install('codex')).body as { installId: string };
    expect((await ended(mac.api, kept.installId)).error).toMatch(/^unsupported: /);
  });

  it('refuses no runner, an old runner, a CLI it does not install, members and viewers', async () => {
    const company = await membersCompany(w);
    const { machineId, runnerKey } = await enroll(w, company);
    expect((await tools(company, machineId).install('codex')).body).toMatchObject({
      error: { code: 'machine_offline' },
    });
    await w.connect(runnerKey);
    expect((await tools(company, machineId).install('codex')).body).toMatchObject({
      error: { code: 'runner_outdated' },
    });
    const { company: mine, machineId: id, api } = await connected();
    expect((await api.install('git')).body).toMatchObject({ error: { code: 'invalid_request' } });
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, mine, role);
      expect((await tools(mine, id, person).install('codex')).status).toBe(403);
    }
    expect((await tools(mine, 'nope').install('codex')).status).toBe(404);
  });
});

describe('GET machines/:machineId/tools/install/:installId', () => {
  it('is a 404 for an unknown install, another machine’s, and another company’s', async () => {
    const { company, machineId, api } = await connected();
    expect((await api.status('nope')).body).toMatchObject({ error: { code: 'install_not_found' } });
    const installId = ((await api.install('codex')).body as { installId: string }).installId;
    await ended(api, installId);
    const { machineId: otherMachine } = await enroll(w, company, { name: 'Other' });
    expect((await tools(company, otherMachine).status(installId)).status).toBe(404);
    const other = await membersCompany(w);
    expect((await tools(other, machineId).status(installId)).status).toBe(404);
    const member = await addMember(w, company, 'member');
    expect((await tools(company, machineId, member).status(installId)).status).toBe(403);
  });
});
