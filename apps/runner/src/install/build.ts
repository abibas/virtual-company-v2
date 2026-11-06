import { join } from 'node:path';
import type { BuildOptions } from 'esbuild';

/**
 * The runner bundle (`pnpm --filter @mwc/runner build`, which runs `scripts/build.ts`; `mwc check --full` too): one ES
 * module, `dist/runner.mjs`, for Node 22 and later, with every dependency inside (`@mwc/shared`, zod, ws), so a machine
 * needs only Node and this file. The server serves it at `GET /api/runner/runner.mjs`; `install` copies it to
 * `~/.local/share/mwc-runner/runner.mjs`, and the container image carries it. Not part of the bundle itself.
 */

/** Where the bundle is written, inside apps/runner. */
export const BUNDLE_FILE = 'dist/runner.mjs';

/** The Node the bundle targets: the Airia devbox has 22. */
export const BUNDLE_TARGET = 'node22';

/**
 * ws is CommonJS: its `require()` of Node's own modules needs a `require` inside an ES module, made from the bundle's
 * own address.
 */
export const BUNDLE_BANNER =
  "import { createRequire as createRunnerRequire } from 'node:module';\n" +
  'const require = createRunnerRequire(import.meta.url);';

/** The esbuild options for the runner package at `root`, carrying `version` (its package.json's). */
export function bundleOptions(root: string, version: string): BuildOptions {
  return {
    entryPoints: [join(root, 'src/main.ts')],
    outfile: join(root, BUNDLE_FILE),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: BUNDLE_TARGET,
    // ws asks for these optional native add-ons inside a try and works without them.
    external: ['bufferutil', 'utf-8-validate'],
    define: { MWC_RUNNER_VERSION: JSON.stringify(version) },
    banner: { js: BUNDLE_BANNER },
    // Readable on the machine that runs it, and small enough as it is.
    minify: false,
    sourcemap: false,
    logLevel: 'info',
  };
}

export interface BuildDeps {
  /** esbuild's `build`. */
  build(options: BuildOptions): Promise<unknown>;
  readFile(path: string): string;
}

/** Builds the bundle of the runner package at `root`; returns its path. */
export async function buildBundle(root: string, deps: BuildDeps): Promise<string> {
  const { version } = JSON.parse(deps.readFile(join(root, 'package.json'))) as { version?: unknown };
  if (typeof version !== 'string' || version === '') throw new Error(`${root}/package.json has no version`);
  await deps.build(bundleOptions(root, version));
  return join(root, BUNDLE_FILE);
}
