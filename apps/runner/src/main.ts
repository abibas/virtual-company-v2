// The runner, `node apps/runner/src/main.ts <command>` or `node runner.mjs <command>` (the bundle); everything it does
// is in cli.ts, on the real process.
import { runCli } from './cli.ts';
import { nodeHost } from './install/system.ts';
import { nodeDeps } from './system/node.ts';

process.exitCode = await runCli(process.argv.slice(2), { daemon: nodeDeps, host: nodeHost });
