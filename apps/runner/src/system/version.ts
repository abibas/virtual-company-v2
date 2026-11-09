/**
 * The runner's version (docs/machines.md, "Runner versions"): its package's semver and the time its bundle was built.
 * The bundle (`dist/runner.mjs`, built by `install/build.ts`) carries both as the constants `MWC_RUNNER_VERSION` and
 * `MWC_RUNNER_BUILT_AT`, which esbuild writes in, because the bundle runs far from its package.json; run from the
 * sources, the runner reads its package.json (`read`) and has no build time.
 */
declare const MWC_RUNNER_VERSION: unknown;
declare const MWC_RUNNER_BUILT_AT: unknown;

/** The version built into the bundle, else what `read` finds. */
export function runnerVersion(read: () => string): string {
  return typeof MWC_RUNNER_VERSION === 'string' ? MWC_RUNNER_VERSION : read();
}

/** When the bundle was built (UTC, ISO 8601), built into it; null from the sources. */
export function runnerBuiltAt(): string | null {
  return typeof MWC_RUNNER_BUILT_AT === 'string' ? MWC_RUNNER_BUILT_AT : null;
}
