// The runner daemon, `node apps/runner/src/main.ts run`; everything it does is in start.ts, on the real process.
import { main } from './start.ts';
import { nodeDeps } from './system/node.ts';

await main(process.argv.slice(2), nodeDeps());
