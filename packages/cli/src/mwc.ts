/** The `mwc` executable: `pnpm mwc <command>` from the repo root. Commands live in `main.ts`. */
import { main } from './main.ts';

process.exitCode = main(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  env: process.env,
});
