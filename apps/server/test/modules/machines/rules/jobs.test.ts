import { describe, expect, it } from 'vitest';
import {
  failureView,
  jobText,
  jobView,
  liveText,
  liveWork,
  machineBusy,
} from '../../../../src/modules/machines/rules/jobs.ts';

const AT = new Date('2026-11-10T09:00:00.000Z');

describe("a machine's jobs", () => {
  it('name the job running to whoever comes next', () => {
    expect(jobText({ kind: 'tool_install', tool: 'codex', version: '0.167.0', startedAt: AT })).toBe(
      'Codex 0.167.0 is being installed: wait for it to finish',
    );
    expect(jobText({ kind: 'tool_install', tool: 'claude', version: '2.1.308', startedAt: AT })).toBe(
      'Claude Code 2.1.308 is being installed: wait for it to finish',
    );
    expect(machineBusy({ kind: 'runner_update', path: 'self_update', startedAt: AT })).toEqual({
      ok: false,
      status: 409,
      code: 'machine_busy',
      message: 'The runner is updating: wait for it to restart',
    });
    expect(jobText({ kind: 'runner_update', path: 'docker_rebuild', startedAt: AT })).toBe(
      'The container is being rebuilt: wait for its runner to restart',
    );
  });

  it('show as the API shows them, null for none', () => {
    expect(jobView(undefined)).toBeNull();
    expect(jobView({ kind: 'tool_install', tool: 'codex', version: '0.167.0', startedAt: AT })).toEqual({
      kind: 'tool_install',
      tool: 'codex',
      version: '0.167.0',
      startedAt: AT.toISOString(),
    });
    expect(jobView({ kind: 'runner_update', path: 'ssh_reinstall', startedAt: AT })).toEqual({
      kind: 'runner_update',
      path: 'ssh_reinstall',
      startedAt: AT.toISOString(),
    });
    expect(
      jobView({ kind: 'runner_update', path: 'docker_rebuild', startedAt: AT, progress: '#3 DONE' }),
    ).toEqual({
      kind: 'runner_update',
      path: 'docker_rebuild',
      startedAt: AT.toISOString(),
      progress: '#3 DONE',
    });
    expect(failureView(undefined)).toBeNull();
    expect(failureView({ path: 'docker_rebuild', message: 'not rebuilt', command: null, at: AT })).toEqual({
      path: 'docker_rebuild',
      message: 'not rebuilt',
      command: null,
      at: AT.toISOString(),
    });
  });

  it('say the live work a runner update would end', () => {
    expect(liveText({ turns: 0, terminals: 0 })).toBeUndefined();
    expect(liveText({ turns: 1, terminals: 0 })).toBe('1 chat turn is running on it');
    expect(liveText({ turns: 0, terminals: 3 })).toBe('3 terminals are running on it');
    expect(liveText({ turns: 2, terminals: 1 })).toBe('2 chat turns and 1 terminal are running on it');
    expect(liveText({ turns: 1, terminals: 1 })).toBe('1 chat turn and 1 terminal are running on it');
    expect(liveWork({ turns: 0, terminals: 0 })).toBeUndefined();
    expect(liveWork({ turns: 2, terminals: 1 })).toMatchObject({
      status: 409,
      code: 'machine_busy',
      message: '2 chat turns and 1 terminal are running on it: update the runner once they end',
    });
    expect(liveWork({ turns: 1, terminals: 0 })?.message).toBe(
      '1 chat turn is running on it: update the runner once it ends',
    );
    expect(liveWork({ turns: 0, terminals: 2 }, 'stop the container')?.message).toBe(
      '2 terminals are running on it: stop the container once they end',
    );
  });

  it("name a container's start or stop, and show it with its action", () => {
    const stop = { kind: 'container_power', action: 'stop', startedAt: AT } as const;
    expect(jobText(stop)).toBe('The container is stopping: wait for it to finish');
    expect(jobText({ ...stop, action: 'start' })).toBe('The container is starting: wait for it to finish');
    expect(jobView(stop)).toEqual({ kind: 'container_power', action: 'stop', startedAt: AT.toISOString() });
  });
});
