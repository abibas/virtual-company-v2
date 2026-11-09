import type { Logger } from 'pino';
import type { RunnerConnection } from '../connection.ts';

/**
 * The hub's sockets (`../hub.ts`): every connection and each machine's current one, a write queue per machine so one
 * machine's frames are recorded in order, and the close of them all at the server's shutdown.
 */

/** The close code of a server going away. */
export const GOING_AWAY = 1001;

/** One promise chain per machine, so a machine's writes run in the order its frames came. */
export function machineQueues(logger: Logger) {
  const queues = new Map<string, Promise<void>>();
  return {
    enqueue(machineId: string, work: () => Promise<void>): void {
      const next = (queues.get(machineId) ?? Promise.resolve()).then(work).catch((error: unknown) => {
        logger.error({ err: error, machineId }, 'runner hub: queued work failed');
      });
      queues.set(machineId, next);
      void next.then(() => {
        if (queues.get(machineId) === next) queues.delete(machineId);
      });
    },
    async idle(): Promise<void> {
      while (queues.size > 0) await Promise.all(queues.values());
    },
  };
}

/** The hub's sockets: every one, and each machine's current one (the one that said hello last). */
export function connections() {
  const current = new Map<string, RunnerConnection>();
  const all = new Set<RunnerConnection>();
  return {
    all,
    /** Makes it its machine's current connection, closing the one it replaces with 4004. */
    claim(connection: RunnerConnection): void {
      const previous = current.get(connection.machineId);
      if (previous !== undefined) {
        previous.replaced = true;
        previous.link.close(4004, 'A newer connection of this machine took over');
      }
      current.set(connection.machineId, connection);
    },
    /** Forgets it; true when it was its machine's current connection. */
    release(connection: RunnerConnection): boolean {
      all.delete(connection);
      if (current.get(connection.machineId) !== connection) return false;
      current.delete(connection.machineId);
      return true;
    },
    /** The machine's current connection once it answered `server.hello`. */
    ready(machineId: string): RunnerConnection | undefined {
      const connection = current.get(machineId);
      return connection?.readyAt === undefined ? undefined : connection;
    },
  };
}

/** Closes every socket with 1001, waits for their closes (cutting the ones still open after `timeoutMs`), then writes. */
export async function closeAll(
  all: ReadonlySet<RunnerConnection>,
  timeoutMs: number,
  idle: () => Promise<void>,
) {
  const open = [...all];
  for (const connection of open) connection.link.close(GOING_AWAY, 'The server is shutting down');
  const closed = Promise.all(open.map((connection) => connection.done));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  if ((await Promise.race([closed, timeout])) === 'timeout') {
    for (const connection of all) connection.link.terminate();
    await closed;
  }
  clearTimeout(timer);
  await idle();
}
