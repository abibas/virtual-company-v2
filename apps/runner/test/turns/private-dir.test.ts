import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrivateDir, ProcessSpec } from '@mwc/harness-core';
import { describe, expect, it } from 'vitest';
import { nodePrivateFs } from '../../src/turns/files.ts';
import {
  asideName,
  PrivateDirs,
  type PrivateFs,
  privatePath,
  releaseLogin,
  WRITTEN_MARKER,
  withPrivateDir,
} from '../../src/turns/private-dir.ts';
import { tempDir } from '../fixtures/runner.ts';

const LOGIN = '{"tokens":{"access_token":"a"}}';
const dirOf = (path: string | null, contents = LOGIN): PrivateDir => ({
  env: 'CODEX_HOME',
  path,
  files: [{ name: 'auth.json', contents, mode: 0o600 }],
});

function world() {
  const stateDir = join(tempDir(), 'state');
  return { stateDir, dirs: new PrivateDirs({ fs: nodePrivateFs(), stateDir }) };
}

describe('the private folders', () => {
  it('are the configuration folder, else the runner’s own per harness and agent folder', () => {
    const hash = createHash('sha256').update('/home/agent').digest('hex').slice(0, 16);
    expect(privatePath(dirOf(null), '/state', 'codex', '/home/agent')).toBe(`/state/codex/${hash}`);
    expect(privatePath(dirOf('/home/agent/.codex-own'), '/state', 'codex', '/home/agent')).toBe(
      '/home/agent/.codex-own',
    );
  });

  it('make the folder 0700, write the login 0600 for the process and remove it after, keeping the folder', () => {
    const { dirs, stateDir } = world();
    const lease = dirs.acquire(dirOf(null), 'codex', '/home/agent');
    expect(lease.path.startsWith(join(stateDir, 'codex'))).toBe(true);
    expect(statSync(lease.path).mode & 0o777).toBe(0o700);
    expect(statSync(join(lease.path, 'auth.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(lease.path, 'auth.json'), 'utf8')).toBe(LOGIN);
    expect(lease.release()).toEqual({});
    expect(lease.release()).toEqual({});
    expect(existsSync(join(lease.path, 'auth.json'))).toBe(false);
    expect(existsSync(join(lease.path, WRITTEN_MARKER))).toBe(false);
    expect(existsSync(lease.path)).toBe(true);
    expect(dirs.inUse).toEqual([]);
  });

  it('keep the files until the last process using the folder ends, and hand back a rewritten login once', () => {
    const { dirs } = world();
    const first = dirs.acquire(dirOf(null), 'codex', '/home/agent');
    const second = dirs.acquire(dirOf(null, '{"second":true}'), 'codex', '/home/agent');
    expect(second.path).toBe(first.path);
    writeFileSync(join(first.path, 'auth.json'), '{"refreshed":true}');
    expect(first.release()).toEqual({ 'auth.json': '{"refreshed":true}' });
    expect(existsSync(join(first.path, 'auth.json'))).toBe(true);
    expect(second.release()).toEqual({});
    expect(existsSync(join(first.path, 'auth.json'))).toBe(false);
  });

  it('set aside a file of that name the runner did not write, and put it back after', () => {
    const { dirs } = world();
    const own = join(tempDir(), 'codex-home');
    mkdirSync(own, { mode: 0o755 });
    writeFileSync(join(own, 'auth.json'), '{"mine":true}');
    const lease = dirs.acquire(dirOf(own), 'codex', '/home/agent');
    expect(readFileSync(join(own, 'auth.json'), 'utf8')).toBe(LOGIN);
    expect(readFileSync(join(own, asideName('auth.json')), 'utf8')).toBe('{"mine":true}');
    expect(statSync(own).mode & 0o777).toBe(0o755);
    lease.release();
    expect(readFileSync(join(own, 'auth.json'), 'utf8')).toBe('{"mine":true}');
    expect(existsSync(join(own, asideName('auth.json')))).toBe(false);
  });

  it('put a folder back as it was when a crashed runner left its files there', () => {
    const own = join(tempDir(), 'codex-home');
    mkdirSync(own);
    writeFileSync(join(own, 'auth.json'), '{"stale":true}');
    writeFileSync(join(own, asideName('auth.json')), '{"mine":true}');
    writeFileSync(join(own, 'other.json'), '{"stale":true}');
    writeFileSync(join(own, WRITTEN_MARKER), 'auth.json\nother.json\n');
    const { dirs } = world();
    const lease = dirs.acquire(dirOf(own), 'codex', '/home/agent');
    expect(existsSync(join(own, 'other.json'))).toBe(false);
    expect(readFileSync(join(own, 'auth.json'), 'utf8')).toBe(LOGIN);
    lease.release();
    expect(readFileSync(join(own, 'auth.json'), 'utf8')).toBe('{"mine":true}');
  });

  it('undo a use whose files could not be written, and throw', () => {
    const fs = nodePrivateFs();
    const failing: PrivateFs = {
      ...fs,
      write: (path, text, mode) => {
        if (path.endsWith('auth.json')) throw new Error('disk full');
        fs.write(path, text, mode);
      },
    };
    const stateDir = join(tempDir(), 'state');
    const dirs = new PrivateDirs({ fs: failing, stateDir });
    expect(() => dirs.acquire(dirOf(null), 'codex', '/home/agent')).toThrow('disk full');
    expect(dirs.inUse).toEqual([]);
    const path = privatePath(dirOf(null), stateDir, 'codex', '/home/agent');
    expect(existsSync(join(path, WRITTEN_MARKER))).toBe(false);
  });

  it('give back a rewritten login, `invalid` for one that is not a login, nothing without a change or a folder', () => {
    const { dirs } = world();
    const write = (text: string) => {
      const lease = dirs.acquire(dirOf(null), 'codex', '/home/agent');
      writeFileSync(join(lease.path, 'auth.json'), text);
      return lease;
    };
    expect(releaseLogin(write('{"fresh":1}'))).toBe('{"fresh":1}');
    expect(releaseLogin(write('[1]'))).toBe('invalid');
    expect(releaseLogin(write(LOGIN))).toBeUndefined();
    expect(releaseLogin(undefined)).toBeUndefined();
  });
});

describe('withPrivateDir', () => {
  const SETTINGS = { name: 'settings-0a1b.json', contents: '{"env":{}}', mode: 0o600, option: '--settings' };
  const spec = (privateDir?: PrivateDir): ProcessSpec => ({
    command: 'claude',
    args: ['-p'],
    env: {},
    unsetEnv: [],
    stdin: null,
    notices: [],
    ...(privateDir ? { privateDir } : {}),
  });

  it('names each file with an option after the arguments by its full path, and gives no variable without one', () => {
    const { dirs } = world();
    const process = spec({ path: null, files: [SETTINGS, { name: 'plain', contents: 'x', mode: 0o600 }] });
    const lease = dirs.acquire(process.privateDir as PrivateDir, 'claude_code', '/home/agent');
    const ready = withPrivateDir(process, lease);
    expect(ready.process.args).toEqual(['-p', '--settings', join(lease.path, 'settings-0a1b.json')]);
    expect(ready.env).toEqual({});
    expect(readFileSync(join(lease.path, 'settings-0a1b.json'), 'utf8')).toBe('{"env":{}}');
    lease.release();
    expect(existsSync(join(lease.path, 'settings-0a1b.json'))).toBe(false);
  });

  it('gives the folder’s variable, and leaves a spec without files to name, or without a folder, as it is', () => {
    const { dirs } = world();
    const codex = spec(dirOf(null));
    const lease = dirs.acquire(codex.privateDir as PrivateDir, 'codex', '/home/agent');
    const ready = withPrivateDir(codex, lease);
    expect(ready).toEqual({ process: codex, env: { CODEX_HOME: lease.path } });
    expect(withPrivateDir(spec(), undefined)).toEqual({ process: spec(), env: {} });
    expect(withPrivateDir(codex, undefined)).toEqual({ process: codex, env: {} });
    lease.release();
  });
});
