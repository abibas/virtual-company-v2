import { readRunnerConfig, runnerConfigPath } from '../config.ts';
import { HEALTH_PATH, type HealthStatus, healthPort } from '../daemon/health.ts';
import { EXIT } from '../daemon/start.ts';
import { CommandError, type Host } from './host.ts';
import { serviceManager } from './service.ts';

/**
 * `mwc-runner status`: the enrollment (runner.json), the service file, and what the running runner says on its health
 * endpoint (127.0.0.1:9953). No process start: the service is "installed" when its file is there, and running when
 * the endpoint answers. Exits 0 only when the runner is connected to the server.
 */

/** How long the health endpoint may take to answer. */
export const HEALTH_TIMEOUT_MS = 2000;

/** What the health endpoint says, or undefined when nothing answers there. */
export async function readHealth(host: Host, port: number): Promise<HealthStatus | undefined> {
  try {
    const res = await host.fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as HealthStatus) : undefined;
  } catch {
    return undefined;
  }
}

/** The runner's line: connected or not, its version, live runs and hold. */
export function healthText(health: HealthStatus | undefined, port: number): string {
  if (health === undefined) return `not answering on 127.0.0.1:${port}`;
  const held =
    health.holdUntil === null ? 'not held' : `held until ${new Date(health.holdUntil).toISOString()}`;
  const link = health.connected ? 'connected to the server' : 'running, not connected to the server';
  return `${link} · version ${health.version} · ${health.liveRuns} live runs · ${held}`;
}

function machineText(host: Host): string {
  const path = runnerConfigPath(host.env);
  try {
    const config = readRunnerConfig(path);
    return `"${config.name}", machine ${config.machineId}, on ${config.serverUrl} (${path})`;
  } catch (error) {
    return `not enrolled: ${(error as Error).message}`;
  }
}

function serviceText(host: Host): string {
  try {
    const manager = serviceManager(host);
    const installed = host.fs.exists(manager.file) ? 'installed' : 'not installed';
    return `${manager.name} ${installed} (${manager.file})`;
  } catch (error) {
    return (error as Error).message;
  }
}

export async function statusCommand(host: Host): Promise<number> {
  let port: number;
  try {
    port = healthPort(host.env);
  } catch (error) {
    throw new CommandError((error as Error).message, EXIT.config);
  }
  const health = await readHealth(host, port);
  host.out(
    `Machine: ${machineText(host)}\nService: ${serviceText(host)}\nRunner:  ${healthText(health, port)}\n`,
  );
  return health?.connected ? 0 : 1;
}
