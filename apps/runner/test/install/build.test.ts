import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildOptions } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { BUNDLE_BANNER, BUNDLE_FILE, buildBundle, bundleOptions } from '../../src/install/build.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the runner bundle', () => {
  it('is one ES module for Node 22 with every dependency inside but the native add-ons ws can do without', () => {
    const options = bundleOptions('/repo/apps/runner', '0.1.0');
    expect(options).toMatchObject({
      entryPoints: ['/repo/apps/runner/src/main.ts'],
      outfile: '/repo/apps/runner/dist/runner.mjs',
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['bufferutil', 'utf-8-validate'],
      define: { MWC_RUNNER_VERSION: '"0.1.0"' },
      minify: false,
    });
    expect(options.packages).toBeUndefined();
    // ws's require() of Node's modules gets a real require made from the bundle's own address.
    expect(options.banner?.js).toBe(BUNDLE_BANNER);
    expect(BUNDLE_BANNER).toContain("from 'node:module'");
    expect(BUNDLE_BANNER).toContain('const require = createRunnerRequire(import.meta.url);');
  });

  it("builds with esbuild from the package's version and says where the file is", async () => {
    const built: BuildOptions[] = [];
    const out = await buildBundle('/repo/apps/runner', {
      build: async (options) => built.push(options),
      readFile: () => '{"name":"@mwc/runner","version":"0.4.2"}',
    });
    expect(out).toBe(`/repo/apps/runner/${BUNDLE_FILE}`);
    expect(built[0]?.define).toEqual({ MWC_RUNNER_VERSION: '"0.4.2"' });
    const noVersion = { build: async () => {}, readFile: () => '{"name":"x"}' };
    await expect(buildBundle('/repo/apps/runner', noVersion)).rejects.toThrow('has no version');
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
    expect(script).toContain("import { buildBundle } from '../src/install/build.ts';");
    expect(readFileSync(join(ROOT, '../../.gitignore'), 'utf8')).toMatch(/^dist\/$/m);
  });
});
