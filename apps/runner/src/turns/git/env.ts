import type { TurnGitHub } from '@mwc/shared/harness';
import type { Log } from '../../system/log.ts';
import type { Env } from '../env.ts';
import { writeGitHooks } from './hooks.ts';

/**
 * git and gh in a turn whose profile may push to GitHub (S7.1d, docs/harness.md "git in a turn"): the sign-in's token goes
 * in the turn's process environment only, as `GH_TOKEN` (gh reads it), and git takes its settings from the environment
 * too (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, after any the machine sets): for
 * `https://github.com` an empty credential helper (the machine's own are passed over) then one that prints
 * `x-access-token` and `$GH_TOKEN` when asked (the token itself is never in a setting), `git@github.com:` and
 * `ssh://git@github.com/` rewritten to https (SSH remotes push with the token), and `core.hooksPath` on the runner's
 * hooks (`hooks.ts`), which read the allowlist from `MWC_GIT_REPOS`. git and gh never prompt. Nothing is written to disk
 * but the hooks, which hold no secret; the run folder's meta never holds the environment.
 */

/** git's credential helper for github.com: the token from the turn's environment, for `get` only (never stored). */
export const GIT_CREDENTIAL_HELPER =
  '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$GH_TOKEN"; }; f';

/** git's settings for the turn, in order. */
export function gitSettings(hooksDir: string): readonly (readonly [string, string])[] {
  return [
    ['credential.https://github.com.helper', ''],
    ['credential.https://github.com.helper', GIT_CREDENTIAL_HELPER],
    ['url.https://github.com/.insteadOf', 'git@github.com:'],
    ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
    ['core.hooksPath', hooksDir],
  ];
}

/** How many settings the machine's environment gives git already (`GIT_CONFIG_COUNT`, 0 when none or not a count). */
const countOf = (value: string | undefined) =>
  value !== undefined && /^\d{1,4}$/.test(value) ? Number(value) : 0;

/** The variables the turn adds for git and gh, after the settings in `env` (see above). */
export function gitEnv(github: TurnGitHub, hooksDir: string, env: Env): Record<string, string> {
  const start = countOf(env.GIT_CONFIG_COUNT);
  const settings = gitSettings(hooksDir);
  const out: Record<string, string> = {
    GH_TOKEN: github.token,
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    MWC_GIT_REPOS: github.repos === 'all' ? 'all' : github.repos.map((repo) => repo.toLowerCase()).join(','),
    GIT_CONFIG_COUNT: String(start + settings.length),
  };
  settings.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${start + i}`] = key;
    out[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return out;
}

/**
 * A turn's environment with git's and gh's GitHub sign-in when its spec carries one (see above), its hooks written first;
 * when they cannot be written the turn runs without the sign-in (logged, never the token), so no push goes unguarded.
 */
export function withGitHub(
  env: Record<string, string>,
  github: TurnGitHub | undefined,
  hooksDir: string | undefined,
  log: Log,
  turnId: string,
): Record<string, string> {
  if (github === undefined) return env;
  try {
    if (hooksDir === undefined) throw new Error('this runner has no git hooks folder');
    return { ...env, ...gitEnv(github, writeGitHooks(hooksDir), env) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('this turn runs without its GitHub sign-in: the git hooks could not be written', {
      turnId,
      reason,
    });
    return env;
  }
}
