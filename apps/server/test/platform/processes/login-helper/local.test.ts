import { describe, expect, it, vi } from 'vitest';
import { localLoginHelper, sandboxEnv } from '../../../../src/platform/processes/login-helper/local.ts';
import { ttyArgv } from '../../../../src/platform/processes/login-helper/tty.ts';
import { fakeSpawn } from '../../../fixtures/credentials/sign-in/child.ts';

const HOME = '/tmp/mwc-login-abc123';
const ARGV = ['codex', 'login', '--device-auth', '-c', 'cli_auth_credentials_store=file'];

function localWorld(files: Record<string, string> = {}) {
  const { spawn, calls } = fakeSpawn();
  const fs = {
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}abc123`),
    readFile: vi.fn(async (path: string) => {
      const text = files[path];
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return text;
    }),
    rm: vi.fn(async () => {}),
  };
  const helper = localLoginHelper({ spawn, fs, tmpDir: '/tmp', path: '/usr/local/bin:/usr/bin:/bin' });
  return { helper, calls, fs };
}

describe('sandboxEnv', () => {
  it('is made from nothing: the home, PATH, the terminal and the CLIs switches, no CLAUDE_CONFIG_DIR, no key', () => {
    expect(sandboxEnv(HOME, '/usr/bin')).toEqual({
      HOME,
      CODEX_HOME: `${HOME}/.codex`,
      PATH: '/usr/bin',
      TERM: 'xterm-256color',
      LANG: 'C.UTF-8',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      NO_UPDATE_NOTIFIER: '1',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_TELEMETRY: 'false',
      GH_SPINNER_DISABLED: '1',
    });
  });
});

describe('localLoginHelper', () => {
  it("runs the login behind script in a fresh temporary home, with that home's environment only", async () => {
    const w = localWorld();
    expect(w.helper.mode).toBe('local');
    await w.helper.start({ argv: ARGV });
    expect(w.fs.mkdtemp).toHaveBeenCalledWith('/tmp/mwc-login-');
    const [program, ...args] = ttyArgv(ARGV);
    expect(w.calls[0]?.command).toBe(program);
    expect(w.calls[0]?.args).toEqual(args);
    expect(w.calls[0]?.options).toEqual({
      cwd: HOME,
      env: sandboxEnv(HOME, '/usr/local/bin:/usr/bin:/bin'),
      stdio: 'pipe',
    });
  });

  it('runs a login that must not prompt with plain pipes, and short commands in the same home and environment', async () => {
    const w = localWorld();
    const sandbox = await w.helper.start({ argv: ['gh', 'auth', 'login', '--web'], tty: false });
    expect(w.calls[0]?.command).toBe('gh');
    expect(w.calls[0]?.args).toEqual(['auth', 'login', '--web']);
    const ran = sandbox.run(['gh', 'auth', 'token', '--hostname', 'github.com']);
    w.calls[1]?.child.answer('gho_FAKE\n', 0);
    expect(await ran).toEqual({ code: 0, stdout: 'gho_FAKE\n' });
    expect(w.calls[1]?.command).toBe('gh');
    expect(w.calls[1]?.args).toEqual(['auth', 'token', '--hostname', 'github.com']);
    expect(w.calls[1]?.options).toEqual({
      stdio: 'pipe',
      cwd: HOME,
      env: sandboxEnv(HOME, '/usr/local/bin:/usr/bin:/bin'),
    });
  });

  it('reads files under that home, undefined when one is not there', async () => {
    const w = localWorld({ [`${HOME}/.codex/auth.json`]: '{"tokens":{}}' });
    const sandbox = await w.helper.start({ argv: ARGV });
    expect(await sandbox.readFile('.codex/auth.json')).toBe('{"tokens":{}}');
    expect(await sandbox.readFile('.claude.json')).toBeUndefined();
  });

  it('kills the login and removes the whole home', async () => {
    const w = localWorld();
    const sandbox = await w.helper.start({ argv: ARGV });
    await sandbox.kill();
    expect(w.calls[0]?.child.signals).toEqual(['SIGKILL']);
    expect(w.fs.rm).toHaveBeenCalledWith(HOME, { recursive: true, force: true });
  });

  it('sweeps nothing at startup: a folder names no server, and its own shutdown removed its homes', async () => {
    const w = localWorld();
    expect(await w.helper.sweep()).toBe(0);
    expect(w.calls).toEqual([]);
    expect(w.fs.rm).not.toHaveBeenCalled();
  });

  it('says plainly when the tools are not installed', async () => {
    const w = localWorld();
    const sandbox = await w.helper.start({ argv: ARGV });
    const exit = new Promise((resolve) => sandbox.onExit(resolve));
    w.calls[0]?.child.failToStart();
    expect(await exit).toEqual({
      code: null,
      error: 'The sign-in tools (script, claude, codex, gh) are not installed on this server.',
    });
  });
});
