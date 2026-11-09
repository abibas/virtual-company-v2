import type { ProcessRunOptions } from '@mwc/machine-airia-devbox';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it } from 'vitest';
import { detectPowerExecutor } from '../../src/power/detect.ts';
import { NO_POWER } from '../../src/power.ts';

type ExecFileOptions = Parameters<NonNullable<ProcessRunOptions['execFile']>>[2];

const HOME = '/Users/ihor';
/** A file system where only these paths exist. */
const only =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe('detectPowerExecutor', () => {
  it('drives nothing unless both airia and gcloud are there', () => {
    for (const exists of [only(), only('/opt/homebrew/bin/airia'), only('/usr/local/bin/gcloud')]) {
      expect(detectPowerExecutor({ env: { PATH: '/usr/bin' }, home: HOME, exists })).toBe(NO_POWER);
    }
  });

  it('powers Airia devboxes with both, running them by their full paths with their folders on the PATH', async () => {
    const runs: { file: string; args: string[]; options: ExecFileOptions }[] = [];
    const instance = {
      name: 'dev-ihor',
      zone: 'zones/europe-west1-b',
      status: 'TERMINATED',
      machineType: 'e2-standard-8',
    };
    const execFile = (
      file: string,
      args: string[],
      options: ExecFileOptions,
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      runs.push({ file, args, options });
      callback(null, JSON.stringify(instance), '');
    };
    const executor = detectPowerExecutor({
      env: { PATH: '/usr/bin', HOME },
      home: HOME,
      exists: only('/opt/homebrew/bin/airia', '/Users/ihor/google-cloud-sdk/bin/gcloud'),
      execFile,
    });
    expect(executor.providers).toEqual(['airia_devbox']);
    const result = await executor.execute({
      type: 'power.command',
      cmdId: newId(),
      target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
      action: 'status',
    });
    expect(result).toMatchObject({ ok: true, status: 'stopped', metadata: { size: 'm', hourlyCost: 0.268 } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.file).toBe('/Users/ihor/google-cloud-sdk/bin/gcloud');
    expect(runs[0]?.options.env.PATH?.split(':').slice(0, 3)).toEqual([
      '/opt/homebrew/bin',
      '/Users/ihor/google-cloud-sdk/bin',
      '/usr/local/bin',
    ]);
    expect(runs[0]?.options.env.HOME).toBe(HOME);
    // Its tunnels run that gcloud with the same environment.
    const tunnel = executor.tunnelCommand?.({
      machineId: newId(),
      target: { provider: 'airia_devbox', ref: { instance: 'dev-ihor', zone: 'europe-west1-b' } },
      remotePort: 9950,
      localPort: 9950,
    });
    expect(tunnel?.command).toBe('/Users/ihor/google-cloud-sdk/bin/gcloud');
    expect(tunnel?.args.slice(0, 3)).toEqual(['compute', 'ssh', 'dev-ihor']);
    expect(tunnel?.env).toEqual(runs[0]?.options.env);
    expect(runs).toHaveLength(1);
  });
});
