import { EventEmitter } from 'node:events';
import type { TunnelChild, TunnelSpawnOptions } from '@mwc/machines-core/tunnels';
import { ConfigError, loadConfig } from '@mwc/shared/config';
import type { TunnelState } from '@mwc/shared/runner-protocol';
import { captureLogger, LEVEL } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  groupKiller,
  LOCAL_POWER_NAME,
  localPowerFromConfig,
  nodePowerHost,
  type PowerHost,
} from '../../../../src/platform/processes/power/local.ts';

const HOME = '/Users/ihor';
const AIRIA = '/opt/homebrew/bin/airia';
const GCLOUD = '/Users/ihor/google-cloud-sdk/bin/gcloud';
const DB = 'postgres://mwc:mwc@127.0.0.1:9999/mwc';
const config = (env: Record<string, string> = {}) => loadConfig({ DATABASE_URL: DB, ...env });

/** A computer where only these files exist, whose spawn records each call and whose process groups die on a signal. */
function host(...files: string[]) {
  const looked: string[] = [];
  const spawned: { file: string; args: readonly string[]; options: TunnelSpawnOptions }[] = [];
  const kills: { pid: number; signal: string }[] = [];
  const children: (EventEmitter & { stderr: EventEmitter })[] = [];
  const fake: PowerHost = {
    env: { PATH: '/usr/bin', HOME },
    home: HOME,
    exists: (path) => {
      looked.push(path);
      return files.includes(path);
    },
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      const child = Object.assign(new EventEmitter(), {
        pid: 7000 + children.length,
        stderr: new EventEmitter(),
      });
      children.push(child);
      return child as unknown as TunnelChild;
    },
    killGroup: (pid, signal) => {
      kills.push({ pid, signal });
      setImmediate(() => children[pid - 7000]?.emit('close', null, signal));
    },
  };
  return { fake, looked, spawned, kills, children };
}

const linesOf = (lines: { msg: string }[]) => lines.map((line) => line.msg);

describe('localPowerFromConfig', () => {
  it('drives nothing and looks for nothing when MWC_LOCAL_POWER is off, or auto in production', () => {
    for (const env of [{ MWC_LOCAL_POWER: 'off' }, { NODE_ENV: 'production', MWC_LOCAL_POWER: 'auto' }]) {
      const { logger, lines } = captureLogger();
      const computer = host(AIRIA, GCLOUD);
      expect(localPowerFromConfig({ ...config(), ...env } as never, logger, computer.fake)).toBeUndefined();
      expect(computer.looked).toEqual([]);
      expect(linesOf(lines)).toHaveLength(1);
      expect(linesOf(lines)[0]).toMatch(/runner controllers start and stop the devboxes$/);
    }
    // Off needs no computer at all: the default one is never asked.
    const { logger } = captureLogger();
    expect(localPowerFromConfig(config({ MWC_LOCAL_POWER: 'off' }), logger)).toBeUndefined();
  });

  it('says which tool is missing under auto, and refuses to start under on without it', () => {
    const { logger, lines } = captureLogger();
    expect(localPowerFromConfig(config(), logger, host(GCLOUD).fake)).toBeUndefined();
    expect(lines).toEqual([
      expect.objectContaining({
        missing: ['airia'],
        msg: expect.stringMatching(/^power: no airia on the PATH or in \/opt\/homebrew\/bin, /),
      }),
    ]);
    const on = config({ MWC_LOCAL_POWER: 'on' });
    expect(() => localPowerFromConfig(on, logger, host().fake)).toThrow(ConfigError);
    expect(() => localPowerFromConfig(on, logger, host().fake)).toThrow(
      /MWC_LOCAL_POWER: is on, but airia and gcloud are not found on the PATH/,
    );
    expect(() => localPowerFromConfig(on, logger, host(AIRIA).fake)).toThrow(/but gcloud is not found/);
  });

  it('uses both tools when they are found (on in production too), saying which, without starting anything', async () => {
    for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'production', MWC_LOCAL_POWER: 'on' }]) {
      const { logger, lines } = captureLogger();
      const computer = host(AIRIA, GCLOUD);
      const local = localPowerFromConfig({ ...config(), ...env } as never, logger, computer.fake);
      expect(local?.name).toBe(LOCAL_POWER_NAME);
      expect(local?.driver.provider).toBe('airia_devbox');
      expect(lines).toEqual([
        expect.objectContaining({
          airia: AIRIA,
          gcloud: GCLOUD,
          msg: 'power: this server starts and stops the devboxes with the airia CLI and holds their tunnels with gcloud',
        }),
      ]);
      expect(computer.spawned).toEqual([]);
    }
  });

  it("holds a box's tunnel with gcloud by its full path, detached, and stops its group at close", async () => {
    const { logger, lines } = captureLogger();
    const computer = host(AIRIA, GCLOUD);
    const local = localPowerFromConfig(config(), logger, computer.fake);
    const reports: TunnelState[] = [];
    const tunnels = local?.tunnels((state) => reports.push(state));
    const machineId = '019a0000-0000-7000-8000-0000000000b0';
    const ref = { instance: 'dev-ihorherasko', zone: 'europe-west1-b' };
    tunnels?.set([
      { machineId, target: { provider: 'airia_devbox', ref }, remotePort: 9950, localPort: 9950 },
    ]);
    expect(computer.spawned).toHaveLength(1);
    expect(computer.spawned[0]).toMatchObject({
      file: GCLOUD,
      options: { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
    });
    expect(computer.spawned[0]?.args.slice(0, 3)).toEqual(['compute', 'ssh', 'dev-ihorherasko']);
    expect(computer.spawned[0]?.args.at(-1)).toBe('127.0.0.1:9950:127.0.0.1:9950');
    expect(computer.spawned[0]?.options.env?.PATH?.split(':').slice(0, 2)).toEqual([
      '/opt/homebrew/bin',
      '/Users/ihor/google-cloud-sdk/bin',
    ]);
    expect(reports).toEqual([{ type: 'tunnel.state', machineId, state: 'connecting' }]);
    await tunnels?.close();
    expect(computer.kills).toEqual([{ pid: 7000, signal: 'SIGTERM' }]);
    expect(linesOf(lines)).toContain('power: starting a tunnel');
  });

  it('warns when a tunnel ends, and starts nothing after close', async () => {
    const { logger, lines } = captureLogger();
    const computer = host(AIRIA, GCLOUD);
    const tunnels = localPowerFromConfig(config(), logger, computer.fake)?.tunnels(() => {});
    const ref = { instance: 'dev-ihorherasko', zone: 'europe-west1-b' };
    const machineId = '019a0000-0000-7000-8000-0000000000b1';
    tunnels?.set([
      { machineId, target: { provider: 'airia_devbox', ref }, remotePort: 9950, localPort: 9950 },
    ]);
    computer.children[0]?.emit('close', 255, null);
    expect(lines.at(-1)).toMatchObject({
      level: LEVEL.warn,
      msg: 'power: a tunnel ended; starting it again later',
      error: 'exited with code 255',
    });
    await tunnels?.close();
    expect(computer.spawned).toHaveLength(1);
  });
});

describe("a stale holder of a box's tunnel port", () => {
  it("is cleared once with the driver's command when the box's port is taken", async () => {
    const { logger, lines } = captureLogger();
    const computer = host(AIRIA, GCLOUD);
    const reports: TunnelState[] = [];
    const tunnels = localPowerFromConfig(config(), logger, computer.fake)?.tunnels((state) =>
      reports.push(state),
    );
    const ref = { instance: 'dev-ihorherasko', zone: 'europe-west1-b' };
    const machineId = '019a0000-0000-7000-8000-0000000000b2';
    tunnels?.set([
      { machineId, target: { provider: 'airia_devbox', ref }, remotePort: 9950, localPort: 9950 },
    ]);
    const failed = 'Error: remote port forwarding failed for listen port 9950';
    computer.children[0]?.stderr.emit(
      'data',
      `${failed}\nERROR: (gcloud.compute.ssh) exited with return code [255].\n`,
    );
    computer.children[0]?.emit('close', 255, null);
    expect(reports.at(-1)?.error).toMatch(new RegExp(`^${failed} \\(clearing`));
    expect(computer.spawned[1]).toMatchObject({ file: GCLOUD, options: { detached: true } });
    expect(computer.spawned[1]?.args.slice(0, 3)).toEqual(['compute', 'ssh', 'dev-ihorherasko']);
    expect(computer.spawned[1]?.args.at(-1)).toContain('fuser -k -TERM -n tcp 9950');
    computer.children[1]?.emit('close', 0, null);
    expect(linesOf(lines)).toContain("power: cleared a stale holder of the box's port");
    await tunnels?.close();
    expect(computer.spawned).toHaveLength(2);
  });
});

describe("the reinstall of a box's runner", () => {
  it("runs the driver's update command with gcloud by its full path, detached, to its end", async () => {
    const computer = host(AIRIA, GCLOUD);
    const local = localPowerFromConfig(config(), captureLogger().logger, computer.fake);
    const ref = { instance: 'dev-ihorherasko', zone: 'europe-west1-b' };
    const done = local?.reinstallRunner(ref, { apiPort: 9950, installPort: 9954 });
    expect(computer.spawned[0]).toMatchObject({
      file: GCLOUD,
      args: [
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
      ],
      options: { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
    });
    computer.children[0]?.emit('close', 0, null);
    expect(await done).toEqual({ ok: true });
  });
});

describe("this computer's host", () => {
  it('signals a whole process group, and is quiet once it is gone', () => {
    const sent: [number, string][] = [];
    const kill = groupKiller((pid, signal) => {
      sent.push([pid, signal]);
      if (pid === -2) throw new Error('kill ESRCH');
    });
    kill(1, 'SIGTERM');
    expect(() => kill(2, 'SIGKILL')).not.toThrow();
    expect(sent).toEqual([
      [-1, 'SIGTERM'],
      [-2, 'SIGKILL'],
    ]);
  });

  it('is the real PATH, home and files, without starting anything', () => {
    const real = nodePowerHost({ PATH: '/usr/bin' });
    expect(real.env).toEqual({ PATH: '/usr/bin' });
    expect(typeof real.home).toBe('string');
    expect(real.exists('/definitely/not/here/airia')).toBe(false);
    expect(typeof real.spawn).toBe('function');
  });
});
