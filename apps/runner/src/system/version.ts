/**
 * The runner's version. The bundle (`dist/runner.mjs`, built by `install/build.ts`) carries it as the constant
 * `MWC_RUNNER_VERSION`, which esbuild writes in, because the bundle runs far from its package.json; run from the
 * sources, the runner reads its package.json (`read`).
 */
declare const MWC_RUNNER_VERSION: unknown;

/** The version built into the bundle, else what `read` finds. */
export function runnerVersion(read: () => string): string {
  return typeof MWC_RUNNER_VERSION === 'string' ? MWC_RUNNER_VERSION : read();
}
