import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { nodeDeps, readRunnerVersion } from '../../src/system/node.ts';
import { SYSTEM_CLOCK, SYSTEM_TIMERS } from '../../src/system/time.ts';
import { tempDir } from '../fixtures/runner.ts';

describe('the real process behind main', () => {
  it("reads the runner's version from its package.json", () => {
    const own = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(readRunnerVersion()).toBe(own.version);
    const path = join(tempDir(), 'package.json');
    writeFileSync(path, '{"name":"x"}');
    expect(() => readRunnerVersion(pathToFileURL(path))).toThrow(`${path} has no version`);
  });

  it("hands main the process, Node's modules, ws and the system clocks", async () => {
    const deps = nodeDeps();
    expect(deps.env).toBe(process.env);
    expect(deps.platform).toBe(process.platform);
    expect(deps.pid).toBe(process.pid);
    expect(deps.WebSocket).toBe(WebSocket);
    expect(deps.clock).toBe(SYSTEM_CLOCK);
    expect(deps.timers).toBe(SYSTEM_TIMERS);
    expect(deps.version).toBe(readRunnerVersion());
    expect(deps.os.cpus().length).toBeGreaterThan(0);
    const dir = tempDir();
    const file = join(dir, 'keepalive');
    writeFileSync(file, '1762419600\n');
    expect(deps.fs.exists(file)).toBe(true);
    expect(deps.fs.exists(join(dir, 'none'))).toBe(false);
    expect(await deps.fs.readFile(file)).toBe('1762419600\n');
    expect((await deps.fs.statfs(dir)).blocks).toBeGreaterThan(0);
    const state = join(dir, 'state', 'mwc-runner');
    deps.fs.mkdir(state);
    expect(statSync(state).mode & 0o777).toBe(0o700);
    deps.write('');
    const handler = () => {};
    deps.onSignal('SIGINT', handler);
    expect(process.listeners('SIGINT')).toContain(handler);
    process.off('SIGINT', handler);
    deps.keepAlive()();
    // A process group that is not there (beyond any pid) is quietly gone.
    expect(() => deps.killGroup(2 ** 30, 'SIGTERM')).not.toThrow();
    // A power controller only where the airia CLI and gcloud are installed; found without starting either.
    expect(deps.power?.providers.every((provider) => provider === 'airia_devbox')).toBe(true);
  });
});
