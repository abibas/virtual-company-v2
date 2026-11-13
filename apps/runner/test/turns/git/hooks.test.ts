import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOOK_NAMES, HOOK_SCRIPT, writeGitHooks } from '../../../src/turns/git/hooks.ts';
import { tempDir } from '../../fixtures/runner.ts';

/**
 * The runner's git hooks (S7.1d) with real git in temporary repositories: a bare "remote" whose default branch is main
 * and a clone that pushes to it with `core.hooksPath` from the environment, as a turn does. No GitHub address is ever
 * reached: `GIT_ALLOW_PROTOCOL=file` makes git refuse anything but local paths before connecting, and the machine's own
 * git configuration is left out.
 */

const ZERO = '0'.repeat(40);
let root: string;
let hooks: string;
let work: string;

/** git with the machine's configuration left out and no network; `hooked` adds the turn's hooks and allowlist. */
function envOf(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: root,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'no-global-config'),
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    ...extra,
  };
}

const hooked = (repos: string | null = 'acme/*,abibas/sandbox') =>
  envOf({
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hooks,
    MWC_GIT_REPOS: repos ?? undefined,
  });

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, input?: string) {
  const done = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 20_000 });
  return { status: done.status, out: done.stdout, err: done.stderr };
}

/** git in `cwd`; throws on a failure unless `allowFail`. */
function git(cwd: string, args: readonly string[], env = envOf(), allowFail = false) {
  const done = run('git', args, cwd, env);
  if (!allowFail && done.status !== 0) throw new Error(`git ${args.join(' ')}: ${done.err}`);
  return done;
}

const commit = (message: string, env = envOf()) =>
  git(work, ['commit', '--allow-empty', '-qm', message], env);
const head = () => git(work, ['rev-parse', 'HEAD']).out.trim();

/** The pre-push hook run directly, as git would for a push of `lines` to `remote` at `url`. */
const prePush = (remote: string, url: string, lines: string, env = hooked()) =>
  run('sh', [join(hooks, 'pre-push'), remote, url], work, env, lines);

beforeAll(() => {
  root = tempDir();
  hooks = writeGitHooks(join(root, 'state', 'git-hooks'));
  git(root, ['init', '-q', '--bare', '-b', 'main', 'remote.git']);
  git(root, ['init', '-q', '-b', 'main', 'seed']);
  run('git', ['commit', '--allow-empty', '-qm', 'first'], join(root, 'seed'), envOf());
  git(join(root, 'seed'), ['push', '-q', join(root, 'remote.git'), 'main']);
  git(root, ['clone', '-q', join(root, 'remote.git'), 'work']);
  work = join(root, 'work');
}, 30_000);

describe('writing the hooks', () => {
  it('writes every hook read-only in a read-only folder, and again only what changed', () => {
    for (const name of HOOK_NAMES) {
      expect(readFileSync(join(hooks, name), 'utf8')).toBe(HOOK_SCRIPT);
      expect(statSync(join(hooks, name)).mode & 0o777).toBe(0o555);
    }
    expect(statSync(hooks).mode & 0o777).toBe(0o555);
    const dir = writeGitHooks(join(root, 'again'));
    chmodSync(dir, 0o755);
    chmodSync(join(dir, 'pre-push'), 0o755);
    writeFileSync(join(dir, 'pre-push'), 'old');
    chmodSync(join(dir, 'pre-push'), 0o555);
    expect(writeGitHooks(dir)).toBe(dir);
    expect(readFileSync(join(dir, 'pre-push'), 'utf8')).toBe(HOOK_SCRIPT);
    expect(statSync(dir).mode & 0o777).toBe(0o555);
    expect(writeGitHooks(dir)).toBe(dir);
  });
});

describe('pre-push, in a real push', () => {
  it('lets a branch of its own go, and refuses the default branch in words', () => {
    git(work, ['checkout', '-qb', 'feature']);
    commit('feature work');
    expect(git(work, ['push', '-q', 'origin', 'feature'], hooked()).status).toBe(0);
    git(work, ['checkout', '-q', 'main']);
    commit('straight to main');
    const refused = git(work, ['push', 'origin', 'main'], hooked(), true);
    expect(refused.status).not.toBe(0);
    expect(refused.err).toContain(
      'Most Wanted: refused: main is the default branch of origin; push a branch of your own and open a pull request.',
    );
    git(work, ['reset', '-q', '--hard', 'origin/main']);
  });

  it('refuses a push that is not a fast-forward, forced or not, and lets the next fast-forward go', () => {
    git(work, ['checkout', '-q', 'feature']);
    git(work, ['commit', '--amend', '--allow-empty', '-qm', 'rewritten'], envOf());
    const forced = git(work, ['push', '--force', 'origin', 'feature'], hooked(), true);
    expect(forced.status).not.toBe(0);
    expect(forced.err).toContain('refs/heads/feature is not a fast-forward of what origin has');
    git(work, ['reset', '-q', '--hard', 'origin/feature']);
    commit('more work');
    expect(git(work, ['push', '-q', 'origin', 'feature'], hooked()).status).toBe(0);
  });

  it('refuses a deletion', () => {
    const deleted = git(work, ['push', 'origin', '--delete', 'feature'], hooked(), true);
    expect(deleted.status).not.toBe(0);
    expect(deleted.err).toContain('refused: deleting refs/heads/feature');
  });

  it('runs the repository’s own hooks after its own checks, from its git folder or its own hooksPath', () => {
    const own = join(work, '.git', 'hooks');
    const marker = join(root, 'marker');
    writeFileSync(join(own, 'pre-push'), `#!/bin/sh\necho "$1 $(cat)" > "${marker}-push"\n`, { mode: 0o755 });
    writeFileSync(join(own, 'pre-commit'), `#!/bin/sh\ntouch "${marker}-commit"\n`, { mode: 0o755 });
    git(work, ['checkout', '-qb', 'chained']);
    commit('chained', hooked());
    expect(existsSync(`${marker}-commit`)).toBe(true);
    git(work, ['push', '-q', 'origin', 'chained'], hooked());
    expect(readFileSync(`${marker}-push`, 'utf8')).toMatch(
      /^origin refs\/heads\/chained [0-9a-f]{40} refs\/heads\/chained 0{40}\n$/,
    );
    mkdirSync(join(work, '.husky'));
    writeFileSync(join(work, '.husky', 'pre-commit'), `#!/bin/sh\ntouch "${marker}-husky"\nexit 1\n`, {
      mode: 0o755,
    });
    git(work, ['config', 'core.hooksPath', '.husky']);
    const stopped = git(work, ['commit', '--allow-empty', '-qm', 'stopped'], hooked(), true);
    expect(stopped.status).not.toBe(0);
    expect(existsSync(`${marker}-husky`)).toBe(true);
    git(work, ['config', '--unset', 'core.hooksPath']);
  });
});

describe('pre-push, on its own', () => {
  const line = (branch: string, remoteOid = ZERO) =>
    `refs/heads/${branch} ${head()} refs/heads/${branch} ${remoteOid}\n`;

  it('refuses a GitHub repository outside the allowlist by its address, in each form, and takes the rest', () => {
    for (const url of [
      'https://github.com/other/x.git',
      'git@github.com:Other/X',
      'ssh://git@github.com/other/x/',
    ]) {
      const refused = prePush('origin', url, line('topic'));
      expect(refused.status).toBe(1);
      expect(refused.err).toContain(
        "refused: other/x is outside the GitHub repositories this agent's profile reaches (acme/*,abibas/sandbox).",
      );
    }
    for (const url of ['git@github.com:Acme/Web.git', 'https://x-access-token@github.com/abibas/sandbox']) {
      expect(prePush('origin', url, line('topic')).status).toBe(0);
    }
    expect(prePush('origin', 'https://github.com/other/x', line('topic'), hooked('all')).status).toBe(0);
    expect(prePush('origin', 'https://github.com/other/x', line('topic'), hooked(null)).status).toBe(0);
    expect(prePush('origin', 'https://gitlab.example/other/x', line('topic')).status).toBe(0);
  });

  it('refuses main and master when it cannot learn the default branch', () => {
    const url = 'https://github.com/acme/web.git';
    const refused = prePush('nowhere', url, line('master'));
    expect(refused.status).toBe(1);
    expect(refused.err).toContain('master is the default branch of nowhere');
    expect(prePush('nowhere', url, line('topic')).status).toBe(0);
    expect(prePush('nowhere', url, `${line('topic')}\n\n`).status).toBe(0);
  });

  it('refuses an update whose old commit is not here', () => {
    const unknown = prePush('origin', 'https://github.com/acme/web.git', line('topic', 'f'.repeat(40)));
    expect(unknown.status).toBe(1);
    expect(unknown.err).toContain('is not a fast-forward');
  });
});
