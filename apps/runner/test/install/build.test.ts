import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { RUNNER_PTY_TARGETS } from '@mwc/shared/runner-protocol';
import type { BuildOptions } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_BANNER,
  BUNDLE_FILE,
  buildBundle,
  bundleOptions,
  MANIFEST_FILE,
  nodePackFs,
  PTY_DIR,
  packPtys,
} from '../../src/install/build.ts';
import { tempDir } from '../fixtures/runner.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the runner bundle', () => {
  it('is one ES module for Node 22 with every dependency inside but the native add-ons and the PTY', () => {
    const options = bundleOptions('/repo/apps/runner', {
      version: '0.1.0',
      builtAt: '2026-11-09T16:40:00.000Z',
    });
    expect(options).toMatchObject({
      entryPoints: ['/repo/apps/runner/src/main.ts'],
      outfile: '/repo/apps/runner/dist/runner.mjs',
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['bufferutil', 'utf-8-validate', '@lydell/node-pty-*'],
      define: { MWC_RUNNER_VERSION: '"0.1.0"', MWC_RUNNER_BUILT_AT: '"2026-11-09T16:40:00.000Z"' },
      minify: false,
    });
    expect(options.packages).toBeUndefined();
    // ws's require() of Node's modules gets a real require made from the bundle's own address.
    expect(options.banner?.js).toBe(BUNDLE_BANNER);
    expect(BUNDLE_BANNER).toContain("from 'node:module'");
    expect(BUNDLE_BANNER).toContain('const require = createRunnerRequire(import.meta.url);');
  });

  it("builds with esbuild, stamped with the package's version and the build time, and writes runner.json", async () => {
    const built: BuildOptions[] = [];
    const written: Record<string, string> = {};
    const fakes = {
      readBytes: (path: string) => new TextEncoder().encode(`bundle at ${path}`),
      writeFile: (path: string, text: string) => {
        written[path] = text;
      },
      now: () => new Date('2026-11-09T16:40:00.000Z'),
    };
    const out = await buildBundle('/repo/apps/runner', {
      build: async (options) => built.push(options),
      readFile: () => '{"name":"@mwc/runner","version":"0.4.2"}',
      ...fakes,
    });
    expect(out).toBe(`/repo/apps/runner/${BUNDLE_FILE}`);
    expect(built[0]?.define).toEqual({
      MWC_RUNNER_VERSION: '"0.4.2"',
      MWC_RUNNER_BUILT_AT: '"2026-11-09T16:40:00.000Z"',
    });
    expect(JSON.parse(written[`/repo/apps/runner/${MANIFEST_FILE}`] as string)).toEqual({
      version: '0.4.2',
      builtAt: '2026-11-09T16:40:00.000Z',
      sha256: createHash('sha256').update(`bundle at /repo/apps/runner/${BUNDLE_FILE}`).digest('hex'),
    });
    const noVersion = { build: async () => {}, readFile: () => '{"name":"x"}', ...fakes };
    await expect(buildBundle('/repo/apps/runner', noVersion)).rejects.toThrow('has no version');
  });

  it('is versioned 0.5.0 or later in its package.json', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string };
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version).not.toBe('0.1.0');
  });

  it('is what `pnpm --filter @mwc/runner build` runs, through scripts/build.ts, from the dist/ git ignores', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.build).toBe('node scripts/build.ts');
    expect(pkg.devDependencies.esbuild).toMatch(/^\d+\.\d+\.\d+$/);
    const script = read('scripts/build.ts');
    expect(script).toContain("import { build } from 'esbuild';");
    expect(script).toContain("import { buildBundle, nodePackFs, packPtys } from '../src/install/build.ts';");
    expect(script).toContain('packPtys(root, nodePackFs)');
    expect(readFileSync(join(ROOT, '../../.gitignore'), 'utf8')).toMatch(/^dist\/$/m);
  });
});

/** The file names and modes of a tar.gz, read back from its headers. */
function listed(archive: Uint8Array): { name: string; mode: number }[] {
  const tar = gunzipSync(archive);
  const files: { name: string; mode: number }[] = [];
  for (let at = 0; tar[at] !== 0; ) {
    const field = (start: number, length: number) =>
      tar
        .subarray(at + start, at + start + length)
        .toString()
        .replace(/\0.*$/s, '');
    const size = Number.parseInt(field(124, 12), 8);
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    files.push({ name, mode: Number.parseInt(field(100, 8), 8) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** A runner package folder with a stand-in for each system's PTY package. */
function packageWithPtys(): string {
  const root = tempDir();
  for (const target of RUNNER_PTY_TARGETS) {
    const dir = join(root, 'node_modules/@lydell', `node-pty-${target}`);
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), `{"name":"@lydell/node-pty-${target}"}`);
    writeFileSync(join(dir, 'lib/index.js'), 'module.exports = {};\n');
    writeFileSync(join(dir, 'spawn-helper'), '\x7fELF');
    chmodSync(join(dir, 'spawn-helper'), 0o755);
  }
  return root;
}

describe("the terminal's PTY archives", () => {
  it("pack each system's package as dist/pty/<target>.tgz, laid out as node_modules/, modes kept", () => {
    const root = packageWithPtys();
    const out = packPtys(root, nodePackFs);
    expect(out).toEqual(RUNNER_PTY_TARGETS.map((target) => join(root, PTY_DIR, `${target}.tgz`)));
    expect(listed(readFileSync(join(root, PTY_DIR, 'linux-x64.tgz')))).toEqual([
      { name: 'node_modules/@lydell/node-pty-linux-x64/lib/index.js', mode: 0o644 },
      { name: 'node_modules/@lydell/node-pty-linux-x64/package.json', mode: 0o644 },
      { name: 'node_modules/@lydell/node-pty-linux-x64/spawn-helper', mode: 0o755 },
    ]);
    // The same files give the same bytes.
    const first = readFileSync(out[0] as string);
    packPtys(root, nodePackFs);
    expect(readFileSync(out[0] as string).equals(first)).toBe(true);
  });

  it('refuse to build without every package installed', () => {
    expect(() => packPtys(tempDir(), nodePackFs)).toThrow(
      /@lydell\/node-pty-darwin-arm64 is not installed in .*\/node_modules \(pnpm install\)/,
    );
  });

  it('come from the runner package itself, which depends on all four at one exact version', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    const versions = RUNNER_PTY_TARGETS.map((target) => pkg.dependencies[`@lydell/node-pty-${target}`]);
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  });
});
