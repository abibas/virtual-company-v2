import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isServerUrl,
  isShared,
  RunnerConfig,
  RunnerConfigError,
  readRunnerConfig,
  runnerConfigPath,
  runnerStateDir,
  runnerWsUrl,
  writeRunnerConfig,
} from '../src/config.ts';
import { ROTATED_KEY, runnerConfig, tempDir } from './fixtures/runner.ts';

const mode = (path: string) => statSync(path).mode & 0o777;

describe('where the configuration and the state live', () => {
  it('reads runner.json from MWC_RUNNER_CONFIG, MWC_CONFIG_DIR, $XDG_CONFIG_HOME/mwc or ~/.config/mwc', () => {
    expect(runnerConfigPath({ MWC_RUNNER_CONFIG: '/etc/mwc/runner.json', MWC_CONFIG_DIR: '/x' })).toBe(
      '/etc/mwc/runner.json',
    );
    expect(runnerConfigPath({ MWC_CONFIG_DIR: '/x', XDG_CONFIG_HOME: '/xdg' })).toBe('/x/runner.json');
    expect(runnerConfigPath({ XDG_CONFIG_HOME: '/xdg', HOME: '/home/o' })).toBe('/xdg/mwc/runner.json');
    expect(runnerConfigPath({ HOME: '/home/o' })).toBe('/home/o/.config/mwc/runner.json');
    expect(runnerConfigPath({})).toBe(join(homedir(), '.config', 'mwc', 'runner.json'));
  });

  it('keeps state in MWC_RUNNER_STATE_DIR, $XDG_STATE_HOME/mwc-runner or ~/.local/state/mwc-runner', () => {
    expect(runnerStateDir({ MWC_RUNNER_STATE_DIR: '/var/lib/mwc-runner', HOME: '/h' })).toBe(
      '/var/lib/mwc-runner',
    );
    expect(runnerStateDir({ XDG_STATE_HOME: '/xdg/state', HOME: '/h' })).toBe('/xdg/state/mwc-runner');
    expect(runnerStateDir({ HOME: '/home/o' })).toBe('/home/o/.local/state/mwc-runner');
    expect(runnerStateDir({})).toBe(join(homedir(), '.local', 'state', 'mwc-runner'));
  });
});

describe('the server address', () => {
  it.each([
    ['http://localhost:9950', 'ws://localhost:9950/api/runner/ws'],
    ['https://corp.example.ngrok.app/', 'wss://corp.example.ngrok.app/api/runner/ws'],
    ['https://corp.example.com/mwc', 'wss://corp.example.com/mwc/api/runner/ws'],
    ['wss://corp.example.com/api/runner/ws', 'wss://corp.example.com/api/runner/ws'],
    ['ws://127.0.0.1:9960', 'ws://127.0.0.1:9960/api/runner/ws'],
  ])('dials %s at %s', (server, socket) => {
    expect(isServerUrl(server)).toBe(true);
    expect(runnerWsUrl(server)).toBe(socket);
  });

  it.each([
    'localhost:9950',
    'ftp://corp.example.com',
    'https://user:pw@corp.example.com',
    'https://corp.example.com/?x=1',
    'https://corp.example.com/#top',
    'not a url',
  ])('refuses %s', (server) => {
    expect(isServerUrl(server)).toBe(false);
  });
});

describe('the configuration schema', () => {
  it('takes a complete configuration and keeps fields a newer installer adds', () => {
    const config = { ...runnerConfig(), channel: 'stable' };
    expect(RunnerConfig.parse(config)).toEqual(config);
  });

  it.each([
    ['runnerKey', { runnerKey: 'mwc_pk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['machineId', { machineId: 'not-a-uuid' }],
    ['name', { name: '  ' }],
    ['slots', { slots: 65 }],
    ['serverUrl', { serverUrl: 'ftp://x' }],
  ])('refuses a bad %s', (field, change) => {
    const parsed = RunnerConfig.safeParse({ ...runnerConfig(), ...change });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([field]);
  });
});

describe('reading the file', () => {
  it('reads a written configuration back', () => {
    const path = join(tempDir(), 'mwc', 'runner.json');
    const config = runnerConfig();
    writeRunnerConfig(path, config);
    expect(readRunnerConfig(path)).toEqual(config);
  });

  it('says how to enroll when the file is missing', () => {
    const path = join(tempDir(), 'runner.json');
    expect(() => readRunnerConfig(path)).toThrow(RunnerConfigError);
    expect(() => readRunnerConfig(path)).toThrow(
      `${path} does not exist; enroll this machine first (mwc machine enroll-token prints its install command)`,
    );
  });

  it('refuses a folder, broken JSON and an incomplete file, naming the fields', () => {
    const dir = tempDir();
    expect(() => readRunnerConfig(dir)).toThrow(`cannot read ${dir}`);
    const path = join(dir, 'runner.json');
    writeFileSync(path, '{ nope');
    expect(() => readRunnerConfig(path)).toThrow(`${path} is not valid JSON`);
    writeFileSync(path, JSON.stringify({ serverUrl: 'http://localhost:9950', slots: 1 }));
    expect(() => readRunnerConfig(path)).toThrow(/machineId: .*; runnerKey: .*; name: /);
    writeFileSync(path, '[]');
    expect(() => readRunnerConfig(path)).toThrow('(file): ');
  });
});

describe('writing the file', () => {
  it('writes 0600 in a new 0700 folder, and leaves an existing folder as it is', () => {
    const root = tempDir();
    const path = join(root, 'config', 'mwc', 'runner.json');
    writeRunnerConfig(path, runnerConfig());
    expect(mode(path)).toBe(0o600);
    expect(mode(join(root, 'config', 'mwc'))).toBe(0o700);
    expect(isShared(path)).toBe(false);

    const shared = join(root, 'shared');
    mkdirSync(shared, { mode: 0o755 });
    chmodSync(shared, 0o755);
    writeRunnerConfig(join(shared, 'runner.json'), runnerConfig());
    expect(mode(shared)).toBe(0o755);
    expect(mode(join(shared, 'runner.json'))).toBe(0o600);
  });

  it('replaces the file atomically and keeps it 0600 across rewrites (key.rotate)', () => {
    const dir = tempDir();
    const path = join(dir, 'runner.json');
    const config = runnerConfig();
    writeRunnerConfig(path, config);
    chmodSync(path, 0o644);
    expect(isShared(path)).toBe(true);
    writeRunnerConfig(path, { ...config, runnerKey: ROTATED_KEY });
    expect(readRunnerConfig(path).runnerKey).toBe(ROTATED_KEY);
    expect(mode(path)).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['runner.json']);
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('checks the configuration first and leaves the old file when the rename fails', () => {
    const dir = tempDir();
    const path = join(dir, 'runner.json');
    const config = runnerConfig();
    writeRunnerConfig(path, config);
    expect(() => writeRunnerConfig(path, { ...config, slots: -1 })).toThrow();
    const rename = () => {
      throw new Error('EXDEV');
    };
    expect(() => writeRunnerConfig(path, { ...config, name: 'Other' }, { rename })).toThrow('EXDEV');
    expect(readRunnerConfig(path)).toEqual(config);
    expect(readdirSync(dir)).toEqual(['runner.json']);
  });
});
