import { dirname, join } from 'node:path';
import { RunnerBuiltAt } from '@mwc/shared/runner-protocol';

/**
 * The runner's version (docs/machines.md, "Runner versions"): its package's semver and the time its bundle was built.
 * The bundle (`dist/runner.mjs`, built by `install/build.ts`) carries the version as the constant `MWC_RUNNER_VERSION`,
 * which esbuild writes in, because the bundle runs far from its package.json; run from the sources, the runner reads
 * its package.json (`read`). The bundle carries no build time, so two builds of one source are the same bytes: the
 * time lives in the manifest the build writes beside it, `runner.json` (`{ version, builtAt, sha256 }`), which goes
 * everywhere the bundle goes (the server, install.sh, `install`, the self-update, the container image).
 */
declare const MWC_RUNNER_VERSION: unknown;

/** The manifest's name, beside the bundle. */
export const RUNNER_MANIFEST_FILE = 'runner.json';

/** The version built into the bundle, else what `read` finds. */
export function runnerVersion(read: () => string): string {
  return typeof MWC_RUNNER_VERSION === 'string' ? MWC_RUNNER_VERSION : read();
}

/**
 * When the bundle at `selfPath` was built (UTC, ISO 8601): the `builtAt` of the `runner.json` beside it, read once at
 * start; null from the sources, or when the manifest is missing, unreadable or says no valid time.
 */
export function runnerBuiltAt(selfPath: string, readFile: (path: string) => string): string | null {
  if (!selfPath.endsWith('.mjs')) return null;
  try {
    const { builtAt } = JSON.parse(readFile(join(dirname(selfPath), RUNNER_MANIFEST_FILE))) as {
      builtAt?: unknown;
    };
    const parsed = RunnerBuiltAt.safeParse(builtAt);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
