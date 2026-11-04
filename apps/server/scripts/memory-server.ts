/**
 * `pnpm dev:memory`: the API on a fresh in-memory PGlite, migrated on start (src/dev/memory-server.ts), on
 * 127.0.0.1:9950 unless MWC_PORT or MWC_PORT_SLOT say otherwise. `pnpm dev:web` shows the UI against it.
 */
import { startMemoryServer } from '../src/dev/memory-server.ts';

await startMemoryServer(process.env);
