import { afterEach, describe, expect, it } from 'vitest';
import {
  HEALTH_PATH,
  type HealthServer,
  type HealthStatus,
  healthPort,
  startHealthServer,
} from '../../src/daemon/health.ts';

const servers: HealthServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const STATUS: HealthStatus = {
  connected: true,
  liveRuns: 1,
  backlog: 0,
  version: '0.1.0',
  holdUntil: 1_800_000,
};

async function start(status: () => HealthStatus = () => STATUS): Promise<HealthServer> {
  const server = await startHealthServer(0, status);
  servers.push(server);
  return server;
}

describe('the health port', () => {
  it('is 9953 unless MWC_RUNNER_HEALTH_PORT names one (0 for a free one)', () => {
    expect(healthPort({})).toBe(9953);
    expect(healthPort({ MWC_RUNNER_HEALTH_PORT: '' })).toBe(9953);
    expect(healthPort({ MWC_RUNNER_HEALTH_PORT: '0' })).toBe(0);
    expect(healthPort({ MWC_RUNNER_HEALTH_PORT: '9963' })).toBe(9963);
  });

  it.each(['-1', '65536', 'abc', '1.5'])('refuses %s', (raw) => {
    expect(() => healthPort({ MWC_RUNNER_HEALTH_PORT: raw })).toThrow(
      'MWC_RUNNER_HEALTH_PORT must be a port number',
    );
  });
});

describe('GET /healthz', () => {
  it('answers what the runner is doing now, on 127.0.0.1', async () => {
    let connected = false;
    const server = await start(() => ({ ...STATUS, connected }));
    expect(server.port).toBeGreaterThan(0);
    const url = `http://127.0.0.1:${server.port}${HEALTH_PATH}`;
    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/json');
    expect(await first.json()).toEqual({ ...STATUS, connected: false });
    connected = true;
    expect(await (await fetch(`${url}?verbose=1`)).json()).toMatchObject({ connected: true });
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
  });

  it('has nothing else', async () => {
    const server = await start();
    const other = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'not_found' });
    expect((await fetch(`http://127.0.0.1:${server.port}${HEALTH_PATH}`, { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('refuses to start on a port that is taken (another runner)', async () => {
    const server = await start();
    await expect(startHealthServer(server.port, () => STATUS)).rejects.toThrow('EADDRINUSE');
  });
});
