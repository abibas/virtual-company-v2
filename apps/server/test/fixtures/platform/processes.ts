/**
 * Child processes for the server's process runners' tests, faked: timers the test fires by hand, and a spawn whose
 * child the test feeds output to and ends.
 */
import { EventEmitter } from 'node:events';
import type { DockerChild, DockerSpawnOptions } from '../../../src/platform/processes/docker/run.ts';

/** Timers the test fires by hand. */
export function manualTimers() {
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

/** A spawn whose one child has both outputs, which the test writes to and ends. */
export function fakeDockerSpawn(pid: number | null = 4300) {
  const spawned: { file: string; args: readonly string[]; options: DockerSpawnOptions }[] = [];
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { pid: pid ?? undefined, stdout, stderr });
  const kills: string[] = [];
  return {
    spawn: (file: string, args: readonly string[], options: DockerSpawnOptions) => {
      spawned.push({ file, args, options });
      return child as unknown as DockerChild;
    },
    killGroup: (killed: number, signal: string) => void kills.push(`${killed} ${signal}`),
    spawned,
    child,
    stdout,
    stderr,
    kills,
  };
}
