import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PORTS } from '@mwc/shared/ports';

/**
 * The runner's health endpoint for `mwc runner status` and the service manager: `GET /healthz` on 127.0.0.1 only
 * (port 9953, `MWC_RUNNER_HEALTH_PORT`; 0 picks a free one in tests), answering what the runner is doing now.
 */

export interface HealthStatus {
  /** The socket to the server is open and past its handshake. */
  readonly connected: boolean;
  readonly liveRuns: number;
  /** Events journaled and not yet acked (0 until S5's runs). */
  readonly backlog: number;
  readonly version: string;
  /** The end of the hold the driver guarantees, null when not held. */
  readonly holdUntil: number | null;
}

export const HEALTH_PATH = '/healthz';

/** The port: `MWC_RUNNER_HEALTH_PORT` (0 for a free one), else 9953. */
export function healthPort(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.MWC_RUNNER_HEALTH_PORT;
  if (raw === undefined || raw === '') return PORTS.runnerHealth;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`MWC_RUNNER_HEALTH_PORT must be a port number (0–65535), not ${JSON.stringify(raw)}`);
  }
  return port;
}

export interface HealthServer {
  /** The port it listens on. */
  readonly port: number;
  close(): Promise<void>;
}

/** Listens on 127.0.0.1; rejects when the port is taken (another runner on this machine). */
export function startHealthServer(port: number, status: () => HealthStatus): Promise<HealthServer> {
  const server = createServer((request, response) => {
    const path = String(request.url).split('?')[0];
    if (path !== HEALTH_PATH || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(status()));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
