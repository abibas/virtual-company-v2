/**
 * `pnpm --filter @mwc/runner build`: the runner as one file, apps/runner/dist/runner.mjs, stamped with its version
 * (the same bytes for the same sources), its manifest apps/runner/dist/runner.json (`{ version, builtAt, sha256 }`,
 * where the build time lives), and the terminal's PTY for each system, apps/runner/dist/pty/<target>.tgz
 * (src/install/build.ts says how). `mwc check --full` runs it too, straight on Node.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildBundle, nodePackFs, packPtys } from '../src/install/build.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await buildBundle(root, {
  build,
  readFile: (path) => readFileSync(path, 'utf8'),
  readBytes: (path) => readFileSync(path),
  writeFile: (path, text) => writeFileSync(path, text),
  now: () => new Date(),
});
process.stdout.write(`built ${bundle}\n`);
for (const pty of packPtys(root, nodePackFs)) process.stdout.write(`packed ${pty}\n`);
