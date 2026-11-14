import { spawnSync } from 'node:child_process';
import type { MainIo } from '../io.ts';
import { REPO_ROOT } from '../io.ts';

/**
 * The fast lane's tests (`mwc check --fast`, the pre-push hook): during a stage only the tests related to the files this
 * branch changed run, on two workers and without coverage, so a push does not load the machine with the whole suite
 * (Ihor, 2026-11-14: "my laptop is on FIRE"). The whole suite with coverage runs in the default lane and `--full`, at a
 * stage's end. Pure but for `changedFiles`, which asks git.
 */

/** How many test workers the fast lane uses. */
export const FAST_WORKERS = '2';

/** Source files the related tests are looked up from: TypeScript under the workspace groups. */
const SOURCE = /^(apps|packages|connectors)\/.+\.(ts|tsx)$/;

/** The files changed against `origin/main` (committed on this branch, or not yet committed), sources only. */
export function changedFiles(root: string = REPO_ROOT): string[] {
  const git = (args: string[]) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.split('\n').filter(Boolean) ?? [];
  const base = git(['rev-parse', '--verify', '--quiet', 'origin/main']).length > 0 ? 'origin/main' : 'HEAD~1';
  const files = new Set([
    ...git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`]),
    ...git(['diff', '--name-only', '--diff-filter=d', 'HEAD']),
  ]);
  return [...files].filter((file) => SOURCE.test(file)).sort();
}

/** The fast lane's test step: the related tests of `changed`, or nothing to run when no source changed. */
export function fastTestsStep(changed: readonly string[]) {
  if (changed.length === 0) {
    return {
      label: 'tests',
      command: 'pnpm',
      args: ['exec', 'vitest', 'related', '--run'],
      run: (io: MainIo) => {
        io.stdout('no changed sources: related tests skipped\n');
        return true;
      },
    };
  }
  return {
    label: 'tests',
    command: 'pnpm',
    args: ['exec', 'vitest', 'related', '--run', `--maxWorkers=${FAST_WORKERS}`, ...changed],
  };
}
