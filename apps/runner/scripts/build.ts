/**
 * `pnpm --filter @mwc/runner build`: the runner as one file, apps/runner/dist/runner.mjs, and the terminal's PTY for
 * each system, apps/runner/dist/pty/<target>.tgz (src/install/build.ts says how). `mwc check --full` runs it too,
 * straight on Node.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildBundle, nodePackFs, packPtys } from '../src/install/build.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await buildBundle(root, { build, readFile: (path) => readFileSync(path, 'utf8') });
process.stdout.write(`built ${bundle}\n`);
for (const pty of packPtys(root, nodePackFs)) process.stdout.write(`packed ${pty}\n`);
