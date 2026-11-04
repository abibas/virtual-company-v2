// The API server process (`node apps/server/src/main.ts`); everything it does is in platform/start.ts.
import { start } from './platform/start.ts';

await start(process.env);
