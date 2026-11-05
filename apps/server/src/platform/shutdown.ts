import type { Server } from 'node:http';
import type { Logger } from 'pino';

/** How long a graceful shutdown may take before the process exits anyway. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ShutdownDeps {
  /** The listening server (`serve()` returns it). */
  readonly server: Pick<Server, 'close' | 'closeIdleConnections'>;
  /** Closes the database pool. */
  closeDb(): Promise<void>;
  /** Stops the jobs loop (waits for its tick in flight, gives its lock up); absent with MWC_JOBS=off. */
  stopJobs?(): Promise<void>;
  /** Ends what the modules keep in memory (the sign-ins in progress, their sandboxes killed) while the database is open. */
  stopModules?(): Promise<unknown>;
  readonly logger: Logger;
  /** `process.exit`, injectable for tests. */
  exit(code: number): void;
  readonly timeoutMs?: number;
}

/**
 * Returns the signal handler for SIGTERM/SIGINT: stop accepting connections, the jobs loop and the modules' work in
 * memory; let running requests, the jobs' tick and the sign-ins' sandbox kills finish; close the database; exit 0. If
 * that takes longer than the timeout (10 s), exit 1. A second signal while shutting down is ignored, so Ctrl-C twice
 * does not cut the cleanup short.
 */
export function gracefulShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
    deps.logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      deps.logger.error({ timeoutMs }, 'shutdown timed out; exiting');
      deps.exit(1);
    }, timeoutMs);
    timer.unref();
    try {
      const closed = new Promise<void>((resolve, reject) => {
        deps.server.close((error) => (error ? reject(error) : resolve()));
        // Keep-alive connections with no request in flight would hold close() open; drop them now.
        deps.server.closeIdleConnections();
      });
      await Promise.all([closed, deps.stopJobs?.(), deps.stopModules?.()]);
      await deps.closeDb();
      clearTimeout(timer);
      deps.logger.info('shut down');
      deps.exit(0);
    } catch (error) {
      clearTimeout(timer);
      deps.logger.error({ err: error }, 'shutdown failed');
      deps.exit(1);
    }
  };
}
