/**
 * What `mwc check --full` adds after the tests (`check.ts` puts it last): the tests again on the dev Postgres, the
 * runner bundle and the web build.
 */
import type { CheckStep } from '../check.ts';
import { DEV_DATABASE_URL, postgresDown, postgresUp } from '../dev.ts';

/** What the --full Postgres lane needs to know about the machine before it plans its steps. */
export interface FullLane {
  /** The Docker daemon answers; without it the Postgres lane is skipped. */
  readonly docker: boolean;
  /** The dev Postgres (deploy/compose.yml) is already up, e.g. under `mwc dev`; then it is left as it is. */
  readonly postgresRunning: boolean;
}

export const NO_DOCKER: FullLane = { docker: false, postgresRunning: false };

/** The --full steps for the given workspace package directories, in order. */
export function fullSteps(
  flags: ReadonlySet<string>,
  packageDirs: readonly string[],
  lane: FullLane,
): CheckStep[] {
  const steps: CheckStep[] = [];
  // The tests again with TEST_DB=postgres: the db and server integration tests then run on the dev
  // Postgres through postgres.js, each on its own database created and dropped on that server
  // (@mwc/db/testing), never the dev database itself. All projects run, because Vitest 5 reports no
  // coverage when --project filters them; the cli and shared tests ignore TEST_DB (about a second).
  const postgres = lane.docker && packageDirs.includes('packages/db');
  if (postgres) {
    if (!lane.postgresRunning) steps.push(postgresUp);
    steps.push({
      label: 'tests on postgres',
      command: 'pnpm',
      args: [
        'exec',
        'vitest',
        'run',
        ...(flags.has('fast') ? [] : ['--coverage', '--coverage.reportsDirectory=.cache/coverage/postgres']),
      ],
      env: { TEST_DB: 'postgres', TEST_DATABASE_URL: DEV_DATABASE_URL },
    });
  }
  if (packageDirs.includes('apps/runner')) {
    // The runner as one file (apps/runner/dist/runner.mjs, what the server serves to machines), straight on Node.
    steps.push({ label: 'runner bundle', command: process.execPath, args: ['apps/runner/scripts/build.ts'] });
  }
  if (packageDirs.includes('apps/web')) {
    // The production build, straight on Node from the web package (no pnpm or shell process in between).
    // The web has no tests for now (docs/structure.md); its typecheck runs in every lane.
    steps.push({
      label: 'web build',
      command: process.execPath,
      args: ['node_modules/vite/bin/vite.js', 'build'],
      cwd: 'apps/web',
    });
  }
  // Leave the machine as it was: stop the dev Postgres only if this run started it.
  if (postgres && !lane.postgresRunning) steps.push(postgresDown);
  return steps;
}
