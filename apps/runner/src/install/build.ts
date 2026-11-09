import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { RUNNER_PTY_TARGETS } from '@mwc/shared/runner-protocol';
import type { BuildOptions } from 'esbuild';
import { ptyPackage } from '../terminal/loader.ts';
import { tarGz } from './tar.ts';

/**
 * The runner bundle (`pnpm --filter @mwc/runner build`, which runs `scripts/build.ts`; `mwc check --full` too): one ES
 * module, `dist/runner.mjs`, for Node 22 and later, with every dependency inside (`@mwc/shared`, zod, ws), so a machine
 * needs only Node and this file. The server serves it at `GET /api/runner/runner.mjs`; `install` copies it to
 * `~/.local/share/mwc-runner/runner.mjs`, and the container image carries it. The terminal's PTY is native, so it stays
 * out of the bundle: the build packs each system's prebuilt node-pty package as `dist/pty/<target>.tgz` (laid out as
 * `node_modules/@lydell/node-pty-<target>/`), which the server serves at `GET /api/runner/pty/<target>.tgz` and the
 * installer unpacks next to the runner. Not part of the bundle itself.
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

/** The runner's stamp: its package's version and when the bundle was built (UTC, ISO 8601). */
export interface RunnerStamp {
  readonly version: string;
  readonly builtAt: string;
}

/** Beside the bundle: its stamp and SHA-256, which the server reads as the latest runner (`latestRunner`). */
export const MANIFEST_FILE = 'dist/runner.json';

/** The esbuild options for the runner package at `root`, carrying its stamp (`system/version.ts` reads it). */
export function bundleOptions(root: string, stamp: RunnerStamp): BuildOptions {
  return {
    entryPoints: [join(root, 'src/main.ts')],
    outfile: join(root, BUNDLE_FILE),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: BUNDLE_TARGET,
    // ws asks for these optional native add-ons inside a try and works without them; the PTY is loaded from next to
    // the bundle (terminal/loader.ts).
    external: ['bufferutil', 'utf-8-validate', '@lydell/node-pty-*'],
    define: {
      MWC_RUNNER_VERSION: JSON.stringify(stamp.version),
      MWC_RUNNER_BUILT_AT: JSON.stringify(stamp.builtAt),
    },
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
  readBytes(path: string): Uint8Array;
  writeFile(path: string, text: string): void;
  /** The build time. */
  now(): Date;
}

/**
 * Builds the bundle of the runner package at `root`, stamped with its package's version and the build time, and writes
 * `dist/runner.json` (`{ version, builtAt, sha256 }`) beside it; returns the bundle's path.
 */
export async function buildBundle(root: string, deps: BuildDeps): Promise<string> {
  const { version } = JSON.parse(deps.readFile(join(root, 'package.json'))) as { version?: unknown };
  if (typeof version !== 'string' || version === '') throw new Error(`${root}/package.json has no version`);
  const stamp: RunnerStamp = { version, builtAt: deps.now().toISOString() };
  await deps.build(bundleOptions(root, stamp));
  const bundle = join(root, BUNDLE_FILE);
  const sha256 = createHash('sha256').update(deps.readBytes(bundle)).digest('hex');
  deps.writeFile(join(root, MANIFEST_FILE), `${JSON.stringify({ ...stamp, sha256 }, null, 2)}\n`);
  return bundle;
}

/** Where the PTY archives are written, inside apps/runner: `<target>.tgz` for each of `RUNNER_PTY_TARGETS`. */
export const PTY_DIR = 'dist/pty';

/** The files a build reads and writes to pack the PTY. */
export interface PackFs {
  /** Every file under a folder (its symlink followed), as paths relative to it, sorted, with their modes. */
  listFiles(dir: string): { readonly path: string; readonly mode: number }[];
  readBytes(path: string): Uint8Array;
  /** Writes a file, making its folder. */
  writeBytes(path: string, bytes: Uint8Array): void;
}

/** The real files (`scripts/build.ts`). */
export const nodePackFs: PackFs = {
  listFiles: (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return { path: relative(dir, path), mode: statSync(path).mode & 0o777 };
      })
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  readBytes: (path) => readFileSync(path),
  writeBytes: (path, bytes) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  },
};

/**
 * Packs every system's PTY package (the runner's dependencies `@lydell/node-pty-<target>`, all four installed on every
 * machine) as `dist/pty/<target>.tgz`; returns their paths. Throws when one is not installed (run `pnpm install`).
 */
export function packPtys(root: string, fs: PackFs): string[] {
  return RUNNER_PTY_TARGETS.map((target) => {
    const name = ptyPackage(target);
    const dir = join(root, 'node_modules', name);
    let files: ReturnType<PackFs['listFiles']>;
    try {
      files = fs.listFiles(dir);
    } catch {
      throw new Error(`${name} is not installed in ${root}/node_modules (pnpm install)`);
    }
    const entries = files.map((file) => ({
      path: `node_modules/${name}/${file.path}`,
      mode: file.mode,
      body: fs.readBytes(join(dir, file.path)),
    }));
    const out = join(root, PTY_DIR, `${target}.tgz`);
    fs.writeBytes(out, tarGz(entries));
    return out;
  });
}
