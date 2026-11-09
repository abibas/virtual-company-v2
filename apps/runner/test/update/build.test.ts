import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runnerBuild, sha256, updateTarget } from '../../src/update/build.ts';
import { testHost } from '../fixtures/host.ts';
import { sha } from '../fixtures/update.ts';

/** A host running the installed copy (`~/.local/share/mwc-runner/runner.mjs`) under a service manager. */
function installedHost(
  env: Record<string, string | undefined>,
  options: Parameters<typeof testHost>[0] = {},
) {
  const probe = testHost();
  const selfPath = join(probe.home, '.local', 'share', 'mwc-runner', 'runner.mjs');
  const made = testHost({ ...options, env: { HOME: probe.home, ...env }, selfPath });
  return { ...made, selfPath };
}

describe('the build a runner runs', () => {
  it("is its bundle's SHA-256, hashed from the file it was started from", () => {
    const { host } = testHost();
    mkdirSync(dirname(host.selfPath), { recursive: true });
    writeFileSync(host.selfPath, '// the runner\n');
    expect(runnerBuild(host)).toBe(sha('// the runner\n'));
    expect(sha256(Buffer.from('x'))).toBe(sha('x'));
  });

  it('is null from the sources, or for a bundle it cannot read', () => {
    expect(runnerBuild(testHost({ selfPath: '/repo/apps/runner/src/main.ts' }).host)).toBeNull();
    expect(runnerBuild(testHost().host)).toBeNull();
  });
});

describe('whether a runner updates itself', () => {
  it('does for the installed copy under launchd or systemd, with its PTY target', () => {
    const systemd = installedHost({ MWC_RUNNER_SERVICE: 'systemd' });
    expect(updateTarget(systemd.host)).toEqual({
      manager: 'systemd',
      bundle: systemd.selfPath,
      pty: 'linux-arm64',
    });
    const launchd = installedHost({ MWC_RUNNER_SERVICE: 'launchd' }, { platform: 'darwin' });
    expect(updateTarget(launchd.host)).toMatchObject({ manager: 'launchd', pty: 'darwin-arm64' });
  });

  it('does not without a service manager that restarts it, in a container, or from another file', () => {
    expect(updateTarget(installedHost({}).host)).toBeUndefined();
    expect(updateTarget(installedHost({ MWC_RUNNER_SERVICE: 'tini' }).host)).toBeUndefined();
    const container = installedHost({ MWC_RUNNER_SERVICE: 'systemd', MWC_RUNNER_IN_CONTAINER: '1' });
    expect(updateTarget(container.host)).toBeUndefined();
    const downloaded = testHost({ env: { MWC_RUNNER_SERVICE: 'systemd' } });
    expect(updateTarget(downloaded.host)).toBeUndefined();
  });

  it('has no PTY target on a system none is built for', () => {
    const { host } = installedHost({ MWC_RUNNER_SERVICE: 'systemd' }, { platform: 'freebsd' });
    expect(updateTarget(host)?.pty).toBeUndefined();
  });
});
