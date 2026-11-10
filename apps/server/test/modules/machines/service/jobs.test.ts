import { fixedClock, TEST_NOW } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  FAILURE_KEPT_MS,
  machineJobs,
  RESTART_WAIT_MS,
} from '../../../../src/modules/machines/service/jobs.ts';

const INSTALL = { kind: 'tool_install', tool: 'codex', version: '0.167.0' } as const;
const UPDATE = { kind: 'runner_update', path: 'self_update' } as const;

/** The lease of a job that was taken (the test fails otherwise). */
function taken(result: ReturnType<ReturnType<typeof machineJobs>['take']>) {
  if (!result.ok) throw new Error('not taken');
  return result.lease;
}

describe("the machines' maintenance lock", () => {
  it('holds one job per machine: an install refuses an update and the other way round, until released', () => {
    const jobs = machineJobs(fixedClock());
    const install = taken(jobs.take('m1', INSTALL));
    expect(jobs.running('m1')).toEqual({ ...INSTALL, startedAt: new Date(TEST_NOW) });
    expect(jobs.take('m1', UPDATE)).toEqual({
      ok: false,
      running: { ...INSTALL, startedAt: new Date(TEST_NOW) },
    });
    expect(jobs.take('m2', UPDATE).ok).toBe(true);
    install.release();
    expect(jobs.running('m1')).toBeUndefined();
    const update = taken(jobs.take('m1', UPDATE));
    expect(jobs.take('m1', INSTALL)).toMatchObject({ ok: false, running: { kind: 'runner_update' } });
    update.release();
    expect(jobs.take('m1', INSTALL).ok).toBe(true);
  });

  it('follows the path an update goes on, never an install’s', () => {
    const jobs = machineJobs(fixedClock());
    taken(jobs.take('m1', UPDATE)).path('ssh_reinstall');
    expect(jobs.running('m1')).toMatchObject({ kind: 'runner_update', path: 'ssh_reinstall' });
    taken(jobs.take('m2', INSTALL)).path('ssh_reinstall');
    expect(jobs.running('m2')).toEqual({ ...INSTALL, startedAt: new Date(TEST_NOW) });
  });

  it('holds an update carried out until its runner reconnects, or until the wait is over', () => {
    const clock = fixedClock();
    const jobs = machineJobs(clock);
    jobs.connected('m1');
    taken(jobs.take('m1', UPDATE)).restarting();
    expect(jobs.running('m1')).toBeDefined();
    jobs.connected('m1');
    expect(jobs.running('m1')).toBeUndefined();
    taken(jobs.take('m1', UPDATE)).restarting();
    clock.advance(RESTART_WAIT_MS - 1);
    expect(jobs.running('m1')).toBeDefined();
    clock.advance(1);
    expect(jobs.running('m1')).toBeUndefined();
  });

  it('waits no more when the runner reconnected during the update, and an install ignores reconnects', () => {
    const jobs = machineJobs(fixedClock(), { restartWaitMs: 1000 });
    const update = taken(jobs.take('m1', UPDATE));
    jobs.connected('m1');
    expect(jobs.running('m1')).toBeDefined();
    update.restarting();
    expect(jobs.running('m1')).toBeUndefined();
    taken(jobs.take('m2', INSTALL));
    jobs.connected('m2');
    expect(jobs.running('m2')).toBeDefined();
  });

  it('ignores a lease no longer holding the machine', () => {
    const clock = fixedClock();
    const jobs = machineJobs(clock, { restartWaitMs: 1000 });
    const old = taken(jobs.take('m1', UPDATE));
    old.restarting();
    clock.advance(1000);
    const next = taken(jobs.take('m1', INSTALL));
    old.release();
    old.restarting();
    old.path('ssh_reinstall');
    old.progress('#1 [internal] load');
    old.fail('too late', null);
    expect(jobs.running('m1')).toMatchObject({ kind: 'tool_install' });
    expect(jobs.failure('m1')).toBeUndefined();
    next.release();
    expect(jobs.running('m1')).toBeUndefined();
  });

  it("shows a rebuild's latest line, never on an install, cut to 300 characters", () => {
    const jobs = machineJobs(fixedClock());
    const rebuild = taken(jobs.take('m1', { kind: 'runner_update', path: 'docker_rebuild' }));
    rebuild.progress('#9 [bundle 3/3] RUN pnpm install');
    expect(jobs.running('m1')).toMatchObject({ progress: '#9 [bundle 3/3] RUN pnpm install' });
    rebuild.progress('x'.repeat(400));
    expect(jobs.running('m1')).toMatchObject({ progress: 'x'.repeat(300) });
    taken(jobs.take('m2', INSTALL)).progress('npm');
    expect(jobs.running('m2')).not.toHaveProperty('progress');
  });

  it('remembers an update that failed after its answer until the next job or the time is up', () => {
    const clock = fixedClock();
    const jobs = machineJobs(clock);
    taken(jobs.take('m1', { kind: 'runner_update', path: 'docker_rebuild' })).fail(
      'not rebuilt',
      'docker compose up',
    );
    expect(jobs.running('m1')).toBeUndefined();
    expect(jobs.failure('m1')).toEqual({
      path: 'docker_rebuild',
      message: 'not rebuilt',
      command: 'docker compose up',
      at: new Date(TEST_NOW),
    });
    taken(jobs.take('m1', UPDATE)).release();
    expect(jobs.failure('m1')).toBeUndefined();
    taken(jobs.take('m1', INSTALL)).fail('npm failed', null);
    expect(jobs.failure('m1')).toMatchObject({ path: 'docker_rebuild', command: null });
    clock.advance(FAILURE_KEPT_MS - 1);
    expect(jobs.failure('m1')).toBeDefined();
    clock.advance(1);
    expect(jobs.failure('m1')).toBeUndefined();
  });
});
