/**
 * `pnpm --filter @mwc/runner build`: the runner as one file, apps/runner/dist/runner.mjs (src/install/build.ts says
 * how). `mwc check --full` runs it too, straight on Node.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildBundle } from '../src/install/build.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await buildBundle(root, { build, readFile: (path) => readFileSync(path, 'utf8') });
process.stdout.write(`built ${bundle}\n`);
