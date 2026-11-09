import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HarnessError } from '@mwc/harness-core';
import { FakeHarnessDriver, fakeTerminalSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import { harnessLaunch, type ShellMachine, shellLaunch } from '../../src/terminal/launch.ts';
import { FAKE_COMMAND, fakeHarnessHost } from '../fixtures/turns.ts';

const MACHINE: ShellMachine = {
  env: { HOME: '/home/runner', SHELL: '/bin/zsh', MWC_RUNNER_HOLD: 'none', ANTHROPIC_API_KEY: 'stray' },
  home: '/home/runner',
  platform: 'linux',
  exists: (path) => path === '/bin/zsh',
};

describe('what a terminal starts', () => {
  it('is the login shell in the home folder', () => {
    expect(shellLaunch(MACHINE)).toEqual({
      file: '/bin/zsh',
      args: ['-l'],
      cwd: '/home/runner',
      env: {
        HOME: '/home/runner',
        SHELL: '/bin/zsh',
        ANTHROPIC_API_KEY: 'stray',
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
      },
    });
  });

  it("is a chat's harness TUI in the agent's folder, with the driver's environment and its notices above it", () => {
    const notice = { type: 'notice', level: 'warn', message: 'The gateway is not used' } as const;
    const { host, cwd } = fakeHarnessHost({
      driver: { env: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, unsetEnv: ['ANTHROPIC_API_KEY'], notices: [notice] },
    });
    const launch = harnessLaunch(fakeTerminalSpec('claude_code', { cwd, sessionId: 's-1' }), host, MACHINE);
    expect(launch).toEqual({
      file: FAKE_COMMAND,
      args: ['terminal', '--resume', 's-1'],
      cwd,
      env: {
        HOME: '/home/runner',
        SHELL: '/bin/zsh',
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
        CLAUDE_CODE_OAUTH_TOKEN: 't',
      },
      banner: '[warn] The gateway is not used\r\n',
    });
  });

  it("writes a Codex login in the harness's private folder for the session", () => {
    const login = '{"tokens":{"access_token":"a"}}';
    const driver = new FakeHarnessDriver({
      harness: 'codex',
      command: FAKE_COMMAND,
      privateDir: {
        env: 'CODEX_HOME',
        path: null,
        files: [{ name: 'auth.json', contents: login, mode: 0o600 }],
      },
    });
    const { host, cwd } = fakeHarnessHost({ drivers: { codex: driver } });
    const launch = harnessLaunch(fakeTerminalSpec('codex', { cwd }), host, MACHINE);
    if ('refused' in launch) throw new Error(launch.refused);
    const home = launch.env.CODEX_HOME as string;
    expect(launch.lease?.path).toBe(home);
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe(login);
    expect(launch).not.toHaveProperty('banner');
    launch.lease?.release();
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
  });

  it('refuses a harness it does not have, a missing folder, a spec the driver refuses and a folder it cannot make', () => {
    const { host, driver, cwd, root } = fakeHarnessHost();
    expect(harnessLaunch(fakeTerminalSpec('claude_code', { cwd }), undefined, MACHINE)).toEqual({
      refused: 'unsupported',
    });
    expect(harnessLaunch(fakeTerminalSpec('codex', { cwd }), host, MACHINE)).toEqual({
      refused: 'unsupported',
    });
    expect(harnessLaunch(fakeTerminalSpec('claude_code', { cwd: join(cwd, 'gone') }), host, MACHINE)).toEqual(
      {
        refused: 'home_missing',
      },
    );
    driver.failNext(new HarnessError('invalid_spec', 'The session id is not one word.'));
    expect(harnessLaunch(fakeTerminalSpec('claude_code', { cwd }), host, MACHINE)).toEqual({
      refused: 'invalid_spec: The session id is not one word.',
    });
    writeFileSync(join(root, 'file'), 'x');
    const blocked = new FakeHarnessDriver({
      harness: 'codex',
      command: FAKE_COMMAND,
      privateDir: { env: 'CODEX_HOME', path: join(root, 'file', 'home'), files: [] },
    });
    const refused = harnessLaunch(
      fakeTerminalSpec('codex', { cwd }),
      { ...host, drivers: { codex: blocked } },
      MACHINE,
    );
    expect(refused).toEqual({ refused: expect.stringMatching(/^spawn_failed: /) });
  });
});
