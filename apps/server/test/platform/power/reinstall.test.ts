import { EventEmitter } from 'node:events';
import type { TunnelChild, TunnelSpawnOptions } from '@mwc/machines-core/tunnels';
import { describe, expect, it } from 'vitest';
import { KILL_GRACE_MS, REINSTALL_TIMEOUT_MS, runToEnd } from '../../../src/platform/power/reinstall.ts';

/** Timers the test fires by hand. */
function manualTimers() {
  const pending = new Map<number, { ms: number; callback: () => void }>();
  let next = 1;
  return {
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        pending.set(next, { ms, callback });
        return next++;
      },
      clearTimeout: (handle: unknown) => void pending.delete(handle as number),
    },
    /** Fires the pending timer of `ms`. */
    fire(ms: number) {
      for (const [id, timer] of pending) {
        if (timer.ms !== ms) continue;
        pending.delete(id);
        timer.callback();
        return;
      }
      throw new Error(`no timer of ${ms} ms`);
    },
    pending: () => [...pending.values()].map((timer) => timer.ms),
  };
}

/** A spawn whose one child the test ends, with a standard error it writes to. */
function fakeSpawn(pid: number | null = 4200) {
  const spawned: { file: string; args: readonly string[]; options: TunnelSpawnOptions }[] = [];
  const stderr = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { pid: pid ?? undefined, stderr });
  const kills: string[] = [];
  return {
    spawn: (file: string, args: readonly string[], options: TunnelSpawnOptions) => {
      spawned.push({ file, args, options });
      return child as unknown as TunnelChild;
    },
    killGroup: (killed: number, signal: string) => void kills.push(`${killed} ${signal}`),
    spawned,
    child,
    stderr,
    kills,
  };
}

const COMMAND = {
  command: '/opt/homebrew/bin/gcloud',
  args: ['compute', 'ssh', 'dev-ihor'],
  env: { PATH: '/x' },
};

describe('running a process to its end', () => {
  it('starts it detached in its own group with stderr piped, and is ok when it exits 0', async () => {
    const fake = fakeSpawn();
    const { timers, pending } = manualTimers();
    const done = runToEnd({ ...fake, timers }, COMMAND);
    expect(fake.spawned).toEqual([
      {
        file: COMMAND.command,
        args: COMMAND.args,
        options: { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { PATH: '/x' } },
      },
    ]);
    expect(pending()).toEqual([REINSTALL_TIMEOUT_MS]);
    fake.child.emit('close', 0, null);
    expect(await done).toEqual({ ok: true });
    expect(pending()).toEqual([]);
  });

  it("says why it failed: stderr's last line, else its exit code or signal", async () => {
    const said = fakeSpawn();
    const one = runToEnd({ ...said, timers: manualTimers().timers }, { command: 'gcloud', args: [] });
    expect(said.spawned[0]?.options).not.toHaveProperty('env');
    said.stderr.emit('data', Buffer.from('Updating...\nmwc-runner install: Node.js 22 or newer is needed\n'));
    said.child.emit('close', 1, null);
    expect(await one).toEqual({ ok: false, error: 'mwc-runner install: Node.js 22 or newer is needed' });
    const quiet = fakeSpawn();
    const two = runToEnd({ ...quiet, timers: manualTimers().timers }, COMMAND);
    quiet.child.emit('close', 255, null);
    expect(await two).toEqual({ ok: false, error: 'exit code 255' });
    const killed = fakeSpawn();
    const three = runToEnd({ ...killed, timers: manualTimers().timers }, COMMAND);
    killed.child.emit('close', null, 'SIGKILL');
    expect(await three).toEqual({ ok: false, error: 'ended by SIGKILL' });
  });

  it('says why it could not start: a spawn that throws, or an error event, answered once', async () => {
    const throwing = {
      spawn: () => {
        throw new Error('spawn EACCES');
      },
      killGroup: () => {},
      timers: manualTimers().timers,
    };
    expect(await runToEnd(throwing, COMMAND)).toEqual({ ok: false, error: 'spawn EACCES' });
    const fake = fakeSpawn();
    const done = runToEnd({ ...fake, timers: manualTimers().timers }, COMMAND);
    fake.child.emit('error', new Error('spawn gcloud ENOENT'));
    fake.child.emit('close', null, null);
    expect(await done).toEqual({ ok: false, error: 'spawn gcloud ENOENT' });
  });

  it('stops its group past the limit: SIGTERM, then SIGKILL after the grace', async () => {
    const fake = fakeSpawn();
    const time = manualTimers();
    const done = runToEnd({ ...fake, timers: time.timers }, COMMAND, 1000);
    time.fire(1000);
    expect(fake.kills).toEqual(['4200 SIGTERM']);
    time.fire(KILL_GRACE_MS);
    expect(fake.kills).toEqual(['4200 SIGTERM', '4200 SIGKILL']);
    fake.child.emit('close', null, 'SIGKILL');
    expect(await done).toEqual({ ok: false, error: 'it did not end within 1 s' });
  });

  it('kills nothing past the limit for a child without a pid', async () => {
    const fake = fakeSpawn(null);
    const time = manualTimers();
    const done = runToEnd({ ...fake, timers: time.timers }, COMMAND, 1000);
    time.fire(1000);
    fake.child.emit('close', null, null);
    expect(await done).toEqual({ ok: false, error: 'it did not end within 1 s' });
    expect(fake.kills).toEqual([]);
  });
});
