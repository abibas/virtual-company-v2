import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRunnerConfig } from '../../../src/config.ts';
import { enrollCommand, enrolledText, enrollOnFirstBoot } from '../../../src/install/enroll/commands.ts';
import { enrollWorld, NODE, noFetch, SERVER, testHost } from '../../fixtures/host.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { runnerConfig } from '../../fixtures/runner.ts';

let w: Awaited<ReturnType<typeof enrollWorld>>;
beforeAll(async () => {
  w = await enrollWorld();
});
afterAll(() => w.t.close());

describe('mwc-runner enroll', () => {
  it('enrolls, says as what and where the key is, and how to install the service, never showing the token', async () => {
    const { host, home, out } = testHost({ fetch: w.fetch });
    const token = await w.token();
    expect(await enrollCommand(host, { server: SERVER, token, name: 'build-1' })).toBe(0);
    const config = readRunnerConfig(join(home, '.config/mwc/runner.json'));
    expect(out()).toBe(
      `Enrolled this machine as "build-1" (vm), machine ${config.machineId}, on ${SERVER}. ` +
        `Its runner key is in ${home}/.config/mwc/runner.json (readable by you only).\n` +
        `Run it as a service with: ${NODE} ${home}/Downloads/runner.mjs install\n`,
    );
    expect(out()).not.toContain(token);
    expect(out()).not.toContain(config.runnerKey);
  });

  it('names the provider of a machine that has one', () => {
    const config = runnerConfig(SERVER, { name: 'Airia devbox' });
    const text = enrolledText({ config, configPath: '/c.json', kind: 'vm', provider: 'airia_devbox' });
    expect(text).toMatch(/^Enrolled this machine as "Airia devbox" \(vm, airia_devbox\), machine /);
  });
});

describe('the container that enrolls on its first start', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../../../../${path}`, import.meta.url)), 'utf8');

  it('is an image of Node 24 slim with git and tini as PID 1, the bundle, a non-root user and its state volume', () => {
    const dockerfile = read('deploy/Dockerfile.runner');
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:24\.\d+\.\d+-slim$/m);
    expect(dockerfile).toContain('pnpm --filter @mwc/runner build');
    expect(dockerfile).toContain('apt-get install -y --no-install-recommends ca-certificates git tini');
    expect(dockerfile).toContain(
      'COPY --from=bundle /app/apps/runner/dist/runner.mjs /opt/mwc-runner/runner.mjs',
    );
    // The terminal's PTY of the image's own system, beside the bundle.
    expect(dockerfile).toContain('tar -xzf "apps/runner/dist/pty/linux-$(node -p process.arch).tgz" -C /out');
    expect(dockerfile).toContain('COPY --from=bundle /out/node_modules /opt/mwc-runner/node_modules');
    expect(dockerfile).toMatch(/^USER runner$/m);
    for (const env of [
      'MWC_RUNNER_IN_CONTAINER=1',
      'MWC_RUNNER_STATE_DIR=/var/lib/mwc-runner',
      'MWC_RUNNER_CONFIG=/var/lib/mwc-runner/runner.json',
      'MWC_RUNNER_HOLD=none',
    ]) {
      expect(dockerfile).toContain(env);
    }
    expect(dockerfile).toContain('VOLUME /var/lib/mwc-runner /work');
    // The work volume's folder, owned by the runner user, so a new named volume starts writable by it.
    expect(dockerfile).toContain('mkdir -p /opt/mwc-runner /var/lib/mwc-runner /work');
    expect(dockerfile).toContain('chown runner:runner /var/lib/mwc-runner /work');
    // Claude Code and Codex for chat turns, at the exact versions the sign-in helper's image pins.
    const pins = /@anthropic-ai\/claude-code@\d+\.\d+\.\d+ @openai\/codex@\d+\.\d+\.\d+/;
    expect(dockerfile.match(pins)?.[0]).toBe(read('deploy/Dockerfile.login').match(pins)?.[0]);
    expect(dockerfile).toContain('command -v claude codex');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--"]');
    expect(dockerfile).toContain('CMD ["node", "/opt/mwc-runner/runner.mjs", "run"]');
  });

  it('is runner-local in deploy/compose.yml, behind the runner profile, reaching the API on the host', () => {
    const compose = read('deploy/compose.yml');
    const service = compose.slice(compose.indexOf('  runner-local:'), compose.indexOf('\nvolumes:'));
    expect(service).toContain('profiles: [runner]');
    expect(service).toContain('dockerfile: deploy/Dockerfile.runner');
    expect(service).toContain(`MWC_SERVER_URL: \${MWC_SERVER_URL:-http://host.docker.internal:9950}`);
    expect(service).toContain(`MWC_ENROLL_TOKEN: \${MWC_ENROLL_TOKEN:-}`);
    expect(service).toContain('- runner-state:/var/lib/mwc-runner');
    // Agents' home folders survive restarts and rebuilds in the work volume.
    expect(service).toContain('- runner-work:/work');
    expect(service).toContain("fetch('http://127.0.0.1:9953/healthz')");
    expect(service).toContain('stop_grace_period: 90s');
    // The limits the add sheet chooses (2 CPUs, 4 GB and 2 runs at once by default), and a cap on processes.
    expect(service).toContain(`MWC_RUNNER_SLOTS: \${MWC_RUNNER_SLOTS:-2}`);
    expect(service).toContain(`cpus: \${MWC_RUNNER_CPUS:-2}`);
    expect(service).toContain(`mem_limit: \${MWC_RUNNER_MEMORY:-4g}`);
    expect(service).toMatch(/^ {4}pids_limit: \d+$/m);
    expect(compose).toMatch(/^ {2}runner-state:$/m);
    expect(compose).toMatch(/^ {2}runner-work:$/m);
    // The dev Postgres is the only service without a profile: plain `docker compose up` starts just it.
    expect(compose.match(/^ {2}[a-z-]+:$/gm)?.slice(0, 2)).toEqual(['  postgres:', '  runner-local:']);
    expect(compose.slice(0, compose.indexOf('  runner-local:'))).not.toContain('profiles:');
  });
});

describe("a container's first start", () => {
  const boot = (env: Record<string, string>, fetch = w.fetch) => {
    const { host, home } = testHost({ files: ['/.dockerenv'], fetch, env });
    const configPath = join(home, 'state', 'runner.json');
    return { host, configPath, logs: memoryLog() };
  };

  it('enrolls with MWC_ENROLL_TOKEN and MWC_SERVER_URL, as a container named by MWC_RUNNER_NAME', async () => {
    const token = await w.token();
    const env = {
      MWC_SERVER_URL: SERVER,
      MWC_ENROLL_TOKEN: token,
      MWC_RUNNER_NAME: 'runner-local',
      MWC_RUNNER_SLOTS: '3',
    };
    const { host, configPath, logs } = boot(env);
    const configured = { ...host, env: { ...host.env, MWC_RUNNER_CONFIG: configPath } };
    expect(await enrollOnFirstBoot(configured, configPath, logs.log)).toBeUndefined();
    expect(readRunnerConfig(configPath)).toMatchObject({ name: 'runner-local', slots: 3, serverUrl: SERVER });
    expect(logs.messages()).toEqual(['enrolling this machine on its first start', 'enrolled']);
    expect(logs.entries[1]).toMatchObject({ kind: 'container', name: 'runner-local', configPath });
    expect(logs.lines.join('')).not.toContain(token);
    // Enrolled once: the token is not used again on the next start.
    expect(await enrollOnFirstBoot({ ...configured, fetch: noFetch }, configPath, logs.log)).toBeUndefined();
    expect(logs.messages()).toHaveLength(2);
  });

  it('does nothing without both variables, and stops with the reason and its code when enrolling fails', async () => {
    const quiet = boot({ MWC_SERVER_URL: SERVER, MWC_ENROLL_TOKEN: '' }, noFetch);
    expect(await enrollOnFirstBoot(quiet.host, quiet.configPath, quiet.logs.log)).toBeUndefined();
    expect(quiet.logs.messages()).toEqual([]);
    const used = `mwc_et_${'Zz09'.repeat(8)}`;
    const refused = boot({ MWC_SERVER_URL: SERVER, MWC_ENROLL_TOKEN: used, MWC_RUNNER_NAME: '' });
    expect(await enrollOnFirstBoot(refused.host, refused.configPath, refused.logs.log)).toBe(77);
    expect(refused.logs.messages('error')[0]).toMatch(
      /^cannot enroll this machine: the server refused the enrollment token/,
    );
    const broken = boot({ MWC_SERVER_URL: SERVER, MWC_ENROLL_TOKEN: used });
    const failing = {
      ...broken.host,
      hostname: () => {
        throw new Error('no host name');
      },
    };
    expect(await enrollOnFirstBoot(failing, broken.configPath, broken.logs.log)).toBe(1);
    expect(broken.logs.messages('error')).toEqual(['cannot enroll this machine: no host name']);
  });
});
