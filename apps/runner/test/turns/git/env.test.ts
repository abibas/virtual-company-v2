import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_CREDENTIAL_HELPER, gitEnv, withGitHub } from '../../../src/turns/git/env.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { tempDir } from '../../fixtures/runner.ts';

/**
 * git's and gh's GitHub sign-in in a turn's environment (S7.1d): the variables, then real git reading them (its
 * credential helper answering with the token, an SSH remote read as https), with the machine's configuration left out.
 */

const GITHUB = { token: 'ghp_FAKEturnTOKEN', repos: ['AiriaLLC/*', 'abibas/sandbox'] };

describe('the turn’s variables for git and gh', () => {
  it('give the token to gh only as GH_TOKEN, and git its settings, never the token, after the machine’s own', () => {
    const env = gitEnv(GITHUB, '/state/git-hooks', { GIT_CONFIG_COUNT: '2' });
    expect(env).toEqual({
      GH_TOKEN: 'ghp_FAKEturnTOKEN',
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0',
      MWC_GIT_REPOS: 'airiallc/*,abibas/sandbox',
      GIT_CONFIG_COUNT: '7',
      GIT_CONFIG_KEY_2: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_2: '',
      GIT_CONFIG_KEY_3: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_3: GIT_CREDENTIAL_HELPER,
      GIT_CONFIG_KEY_4: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_4: 'git@github.com:',
      GIT_CONFIG_KEY_5: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_5: 'ssh://git@github.com/',
      GIT_CONFIG_KEY_6: 'core.hooksPath',
      GIT_CONFIG_VALUE_6: '/state/git-hooks',
    });
    const settings = Object.entries(env).filter(([key]) => key.startsWith('GIT_CONFIG_'));
    expect(JSON.stringify(settings)).not.toContain('FAKEturnTOKEN');
    expect(gitEnv({ ...GITHUB, repos: 'all' }, '/h', { GIT_CONFIG_COUNT: 'x' })).toMatchObject({
      MWC_GIT_REPOS: 'all',
      GIT_CONFIG_COUNT: '5',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
    });
  });

  it('make real git answer github.com with the token, and read an SSH remote as https', () => {
    const root = tempDir();
    const env = {
      PATH: process.env.PATH,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(root, 'none'),
      ...gitEnv(GITHUB, join(root, 'hooks'), {}),
    };
    const fill = spawnSync('git', ['credential', 'fill'], {
      cwd: root,
      env,
      input: 'protocol=https\nhost=github.com\npath=AiriaLLC/airia-platform.git\n\n',
      encoding: 'utf8',
    });
    expect(fill.stdout).toContain('username=x-access-token\npassword=ghp_FAKEturnTOKEN\n');
    spawnSync('git', ['init', '-q', 'repo'], { cwd: root, env });
    const repo = join(root, 'repo');
    spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:AiriaLLC/airia-platform.git'], {
      cwd: repo,
      env,
    });
    const url = spawnSync('git', ['remote', 'get-url', '--push', 'origin'], {
      cwd: repo,
      env,
      encoding: 'utf8',
    });
    expect(url.stdout.trim()).toBe('https://github.com/AiriaLLC/airia-platform.git');
  });
});

describe('a turn’s environment with its GitHub sign-in', () => {
  it('is unchanged without one, and gets the variables with its hooks written when it has one', () => {
    const { log } = memoryLog();
    const base = { PATH: '/usr/bin' };
    expect(withGitHub(base, undefined, '/never', log, 't-1')).toBe(base);
    const hooks = join(tempDir(), 'git-hooks');
    const env = withGitHub(base, GITHUB, hooks, log, 't-1');
    expect(env).toMatchObject({ PATH: '/usr/bin', GH_TOKEN: GITHUB.token, GIT_CONFIG_VALUE_4: hooks });
    expect(existsSync(join(hooks, 'pre-push'))).toBe(true);
  });

  it('goes without the sign-in, logged without the token, when its hooks cannot be written', () => {
    const { log, entries } = memoryLog();
    const base = { PATH: '/usr/bin' };
    expect(withGitHub(base, GITHUB, undefined, log, 't-1')).toBe(base);
    const locked = join(tempDir(), 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    expect(withGitHub(base, GITHUB, join(locked, 'git-hooks'), log, 't-2')).toBe(base);
    chmodSync(locked, 0o700);
    expect(entries.map((entry) => [entry.msg, entry.turnId])).toEqual([
      ['this turn runs without its GitHub sign-in: the git hooks could not be written', 't-1'],
      ['this turn runs without its GitHub sign-in: the git hooks could not be written', 't-2'],
    ]);
    expect(JSON.stringify(entries)).not.toContain('FAKEturnTOKEN');
  });
});
