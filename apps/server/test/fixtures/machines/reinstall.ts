/**
 * A computer with the airia CLI and gcloud for this server's own driver (`localPowerFromConfig`), faked: gcloud's
 * `describe` answers the box's status the test sets, every process start is recorded, a tunnel (`-N`) stays up until its
 * group is signalled, and a runner's reinstall ends as the test says (exit 0 unless told).
 */
import { EventEmitter } from 'node:events';
import type { TunnelChild, TunnelSpawnOptions } from '@mwc/machines-core/tunnels';
import type { PowerHost } from '../../../src/platform/processes/power/local.ts';

export const AIRIA = '/opt/homebrew/bin/airia';
export const GCLOUD = '/opt/homebrew/bin/gcloud';

export interface Spawned {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: TunnelSpawnOptions;
}

export function reinstallComputer() {
  const spawned: Spawned[] = [];
  const children: EventEmitter[] = [];
  let status = 'RUNNING';
  let end: { code: number | null; stderr?: string } = { code: 0 };
  const execFile: NonNullable<PowerHost['execFile']> = (_file, args, _options, callback) => {
    if (args[2] === 'describe') {
      const instance = { name: args[3], zone: 'projects/airia-devbox/zones/europe-west1-b', status };
      callback(null, JSON.stringify(instance), '');
      return undefined;
    }
    callback(Object.assign(new Error('not in this test'), { code: 1 }), '', 'not in this test');
    return undefined;
  };
  const host: PowerHost = {
    env: { PATH: '/opt/homebrew/bin', HOME: '/Users/ihor' },
    home: '/Users/ihor',
    exists: (path) => path === AIRIA || path === GCLOUD,
    execFile,
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      const stderr = new EventEmitter();
      const child = Object.assign(new EventEmitter(), { pid: 8000 + children.length, stderr });
      children.push(child);
      if (!args.includes('-N')) {
        const { code, stderr: said } = end;
        setImmediate(() => {
          if (said !== undefined) stderr.emit('data', Buffer.from(said));
          child.emit('close', code, null);
        });
      }
      return child as unknown as TunnelChild;
    },
    killGroup: (pid, signal) => {
      setImmediate(() => children[pid - 8000]?.emit('close', null, signal));
    },
  };
  return {
    host,
    /** The reinstalls it ran (every process start but the tunnels). */
    reinstalls: () => spawned.filter((call) => !call.args.includes('-N')),
    /** gcloud's describe says this status from now on (`RUNNING`, `TERMINATED`, …). */
    setStatus: (next: string) => {
      status = next;
    },
    /** The next reinstalls end with this code, having printed this on stderr. */
    endWith: (next: { code: number | null; stderr?: string }) => {
      end = next;
    },
  };
}
