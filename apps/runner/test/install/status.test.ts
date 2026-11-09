import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeRunnerConfig } from '../../src/config.ts';
import type { HealthStatus } from '../../src/daemon/health.ts';
import { healthText, readHealth, statusCommand } from '../../src/install/status.ts';
import { type Fetch, json, testHost } from '../fixtures/host.ts';
import { runnerConfig } from '../fixtures/runner.ts';

const HEALTH: HealthStatus = { connected: true, liveRuns: 1, backlog: 0, version: '0.1.0', holdUntil: null };

/** A health endpoint that answers `health` and records where it was asked. */
function healthAt(health: HealthStatus) {
  const asked: string[] = [];
  const fetch: Fetch = async (url, init) => {
    asked.push(url);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return json(200, health);
  };
  return { fetch, asked };
}

describe("the runner's health", () => {
  it('reads the health endpoint, or nothing when it does not answer or answers an error', async () => {
    const endpoint = healthAt(HEALTH);
    expect(await readHealth(testHost({ fetch: endpoint.fetch }).host, 9953)).toEqual(HEALTH);
    expect(endpoint.asked).toEqual(['http://127.0.0.1:9953/healthz']);
    expect(await readHealth(testHost().host, 9953)).toBeUndefined();
    expect(await readHealth(testHost({ fetch: async () => json(404, {}) }).host, 9953)).toBeUndefined();
  });

  it('says whether it is connected, its version, its live runs and its hold', () => {
    expect(healthText(HEALTH, 9953)).toBe('connected to the server · version 0.1.0 · 1 live runs · not held');
    const held = { ...HEALTH, connected: false, holdUntil: Date.parse('2026-11-06T18:00:00Z') };
    expect(healthText(held, 9953)).toBe(
      'running, not connected to the server · version 0.1.0 · 1 live runs · held until 2026-11-06T18:00:00.000Z',
    );
    expect(healthText(undefined, 9960)).toBe('not answering on 127.0.0.1:9960');
  });
});

describe('mwc-runner status', () => {
  it('shows the enrollment, the installed service and the health; 0 when connected', async () => {
    const { host, home, out } = testHost({ platform: 'darwin', fetch: healthAt(HEALTH).fetch });
    const config = runnerConfig('https://corp.example.test');
    writeRunnerConfig(join(home, '.config/mwc/runner.json'), config);
    const plist = join(home, 'Library/LaunchAgents/com.mwc.runner.plist');
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    writeFileSync(plist, '<plist/>');
    expect(await statusCommand(host)).toBe(0);
    expect(out()).toBe(
      `Machine: "This Mac", machine ${config.machineId}, on https://corp.example.test (${home}/.config/mwc/runner.json)\n` +
        `Service: launchd agent installed (${plist})\n` +
        'Runner:  connected to the server · version 0.1.0 · 1 live runs · not held\n',
    );
  });

  it('says what is missing; 1 when the runner is not connected', async () => {
    const { host, home, out } = testHost({ env: { MWC_RUNNER_HEALTH_PORT: '9960' } });
    expect(await statusCommand(host)).toBe(1);
    expect(out()).toContain(`Machine: not enrolled: ${home}/.config/mwc/runner.json does not exist`);
    expect(out()).toContain(
      `Service: systemd user unit not installed (${home}/.config/systemd/user/mwc-runner.service)`,
    );
    expect(out()).toContain('Runner:  not answering on 127.0.0.1:9960');
    const elsewhere = testHost({ platform: 'win32', fetch: healthAt({ ...HEALTH, connected: false }).fetch });
    expect(await statusCommand(elsewhere.host)).toBe(1);
    expect(elsewhere.out()).toContain(
      'Service: the runner installs as a service on macOS and Linux, not on win32',
    );
  });

  it('refuses a health port that is no port, with the configuration code', async () => {
    const { host } = testHost({ env: { MWC_RUNNER_HEALTH_PORT: 'x' } });
    await expect(statusCommand(host)).rejects.toThrow(expect.objectContaining({ code: 78 }));
  });
});
