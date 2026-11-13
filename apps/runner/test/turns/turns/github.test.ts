import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_COMMAND, fakeHarnessHost, startTurn as start, turnsWorld } from '../../fixtures/turns.ts';

/**
 * A turn's GitHub sign-in for git and gh (S7.1d): it reaches the turn's process only in its environment, with git's
 * settings; it is never on the command line, in the log, or in any file under the runner's state folder (the run
 * folder's meta included) while the turn runs or after; a turn without one gets none.
 */

const GITHUB = { token: 'ghp_FAKEturnTOKEN', repos: ['airiallc/*'] };

/** Every regular file's text under a folder (sockets and the like left out). */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path, 'utf8'));
}

describe('a turn with a GitHub sign-in', () => {
  it('gives it to the process’s environment only, with git’s settings and the hooks folder, never to disk', async () => {
    const { host, cwd, stateDir } = fakeHarnessHost();
    const gitHooks = join(stateDir, 'git-hooks');
    const w = turnsWorld({ host: { ...host, gitHooks } });
    let during: string[] = [];
    w.spawn.when(FAKE_COMMAND, (child) => {
      during = filesUnder(stateDir);
      child.finish('', 0);
    });
    start(w, fakeTurnSpec('claude_code', { cwd, github: GITHUB }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const [call] = w.spawn.calls;
    expect(call?.options.env).toMatchObject({
      GH_TOKEN: 'ghp_FAKEturnTOKEN',
      GIT_TERMINAL_PROMPT: '0',
      MWC_GIT_REPOS: 'airiallc/*',
      GIT_CONFIG_COUNT: '5',
      GIT_CONFIG_KEY_4: 'core.hooksPath',
      GIT_CONFIG_VALUE_4: gitHooks,
    });
    expect(during.length).toBeGreaterThan(0);
    expect(during.some((text) => text.includes('"turnId"'))).toBe(true);
    for (const text of [...during, ...filesUnder(stateDir)]) expect(text).not.toContain('FAKEturnTOKEN');
    expect(call?.args.join(' ')).not.toContain('FAKEturnTOKEN');
    expect(JSON.stringify(w.logs.entries)).not.toContain('FAKEturnTOKEN');
  });

  it('gives none to a turn without one, and none on a runner without its hooks folder', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host: { ...host, gitHooks: join(cwd, '..', 'state', 'git-hooks') } });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish('', 0));
    start(w, fakeTurnSpec('claude_code', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.spawn.calls[0]?.options.env).not.toHaveProperty('GH_TOKEN');
    expect(w.spawn.calls[0]?.options.env).not.toHaveProperty('GIT_CONFIG_COUNT');
    const bare = turnsWorld({ host });
    bare.spawn.when(FAKE_COMMAND, (child) => child.finish('', 0));
    start(bare, fakeTurnSpec('claude_code', { cwd, github: GITHUB }));
    await vi.waitFor(() => expect(bare.ends()).toHaveLength(1));
    expect(bare.spawn.calls[0]?.options.env).not.toHaveProperty('GH_TOKEN');
    expect(bare.logs.messages('warn')).toContain(
      'this turn runs without its GitHub sign-in: the git hooks could not be written',
    );
  });
});
