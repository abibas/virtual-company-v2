import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  containerIds,
  dockerLoginHelper,
  LOGIN_IMAGE_REPOSITORY,
  loginImageTag,
  readLoginDockerfile,
  SANDBOX_HOME,
  SANDBOX_LIFETIME_S,
  sandboxCommandArgs,
  sandboxExecArgs,
  sandboxReadArgs,
  sandboxRemoveArgs,
  sandboxRunArgs,
  sweepListArgs,
} from '../../../../src/platform/processes/login-helper/docker.ts';
import { LoginHelperError } from '../../../../src/platform/processes/login-helper/port.ts';
import { fakeSpawn, type SpawnCall } from '../../../fixtures/credentials/sign-in/child.ts';

const DOCKERFILE = 'FROM node:24.21.0-slim\nRUN npm install --global @anthropic-ai/claude-code@2.1.308\n';
const TAG = loginImageTag(DOCKERFILE);
const ARGV = ['claude', 'auth', 'login', '--claudeai'];
const INSTANCE = 'api-test';
const ID_A = 'a'.repeat(64);
const ID_B = '0123456789ab';

describe('the docker arguments', () => {
  it('tags the image with the first 12 hex digits of the Dockerfile', () => {
    expect(TAG).toMatch(new RegExp(`^${LOGIN_IMAGE_REPOSITORY}:[0-9a-f]{12}$`));
    expect(loginImageTag(DOCKERFILE)).toBe(TAG);
    expect(loginImageTag(`${DOCKERFILE}# changed\n`)).not.toBe(TAG);
  });

  it('runs a sandbox detached, removed when it stops, labelled, locked down, with nothing from the host', () => {
    const args = sandboxRunArgs(TAG, 'mwc-login-test', INSTANCE);
    expect(args.slice(0, 5)).toEqual(['run', '--detach', '--rm', '--name', 'mwc-login-test']);
    for (const flag of ['--read-only', '--rm']) expect(args).toContain(flag);
    const pairs = (flag: string) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
    expect(pairs('--label')).toEqual(['mwc.login-helper=1', `mwc.instance=${INSTANCE}`]);
    expect(pairs('--cap-drop')).toEqual(['ALL']);
    expect(pairs('--security-opt')).toEqual(['no-new-privileges']);
    expect(pairs('--pids-limit')).toEqual(['256']);
    expect(pairs('--memory')).toEqual(['1g']);
    expect(pairs('--cpus')).toEqual(['1']);
    expect(pairs('--user')).toEqual(['1000:1000']);
    expect(pairs('--tmpfs')).toEqual([
      '/tmp:rw,nosuid,nodev,size=64m',
      `${SANDBOX_HOME}:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700`,
    ]);
    expect(args.slice(-3)).toEqual([TAG, 'sleep', String(SANDBOX_LIFETIME_S)]);
    // No mount, volume, environment, env file, host network or device, and no terminal from a parent without one.
    for (const arg of args) {
      expect(arg).not.toMatch(
        /^(-v|--volume|--mount|-e|--env|--env-file|--network=host|--privileged|--device|-t|--tty)/,
      );
    }
  });

  it('runs the login with docker exec -i behind script, reads a home file with cat and removes with rm --force', () => {
    const exec = sandboxExecArgs('box', ARGV);
    expect(exec.slice(0, 5)).toEqual(['exec', '--interactive', 'box', 'script', '-qfec']);
    expect(exec).not.toContain('-t');
    expect(exec).not.toContain('--tty');
    expect(sandboxReadArgs('box', '.claude.json')).toEqual([
      'exec',
      'box',
      'cat',
      '--',
      `${SANDBOX_HOME}/.claude.json`,
    ]);
    expect(sandboxRemoveArgs('box')).toEqual(['rm', '--force', 'box']);
  });

  it('runs a login that must not prompt with plain pipes, and a short command with docker exec and no terminal', () => {
    const argv = ['gh', 'auth', 'login', '--web'];
    expect(sandboxExecArgs('box', argv, false)).toEqual(['exec', '--interactive', 'box', ...argv]);
    expect(sandboxCommandArgs('box', ['gh', 'auth', 'token'])).toEqual([
      'exec',
      'box',
      'gh',
      'auth',
      'token',
    ]);
  });

  it('reads the real Dockerfile: node 24 slim, the AI CLIs and the GitHub CLI at exact versions, no prompts', async () => {
    const text = await readLoginDockerfile();
    expect(text).toMatch(/^FROM node:24\.\d+\.\d+-slim$/m);
    expect(text).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+\s/);
    expect(text).toMatch(/@openai\/codex@\d+\.\d+\.\d+\s/);
    expect(text).toMatch(/releases\/download\/v(\d+\.\d+\.\d+)\/gh_\1_linux_\$\{arch\}\.tar\.gz/);
    expect(text).toMatch(/sha256sum --check --strict/);
    for (const line of ['GH_PROMPT_DISABLED=1', 'GH_TELEMETRY=false', 'GH_NO_UPDATE_NOTIFIER=1']) {
      expect(text).toContain(line);
    }
    expect(text).toMatch(/^USER node$/m);
  });
});

/** Docker as a script: each command answers from `answers` by its first arguments; `docker exec -i` stays running. */
function dockerWorld(
  answers: Record<string, { stdout?: string; code?: number | null; missing?: boolean }> = {},
) {
  const { spawn, calls } = fakeSpawn((call: SpawnCall) => {
    const key = call.args.slice(0, 2).join(' ');
    if (key === 'exec --interactive') return;
    const answer = answers[key] ?? answers[call.args[0] ?? ''] ?? {};
    if (answer.missing) call.child.failToStart();
    else call.child.answer(answer.stdout ?? '', answer.code ?? 0);
  });
  const logs = captureLogger();
  let n = 0;
  const helper = dockerLoginHelper({
    spawn,
    dockerfile: async () => DOCKERFILE,
    logger: logs.logger,
    instance: INSTANCE,
    newName: () => `mwc-login-test-${++n}`,
  });
  const commands = () => calls.map((call) => call.args.slice(0, 2).join(' '));
  return { helper, calls, commands, logs: logs.lines };
}

describe('dockerLoginHelper', () => {
  it('uses the image when it is there, starts the sandbox and runs the login in it', async () => {
    const w = dockerWorld();
    expect(w.helper.mode).toBe('docker');
    const sandbox = await w.helper.start({ argv: ARGV });
    expect(w.commands()).toEqual(['image inspect', 'run --detach', 'exec --interactive']);
    expect(w.calls[0]?.args).toContain(TAG);
    expect(w.calls[1]?.args).toEqual(sandboxRunArgs(TAG, 'mwc-login-test-1', INSTANCE));
    expect(w.calls[2]?.args).toEqual(sandboxExecArgs('mwc-login-test-1', ARGV));
    expect(w.calls.every((call) => call.command === 'docker')).toBe(true);
    sandbox.write('code\r');
    expect(w.calls[2]?.child.input).toEqual(['code\r']);
  });

  it('builds the image from the Dockerfile on stdin with no context, once, when it is missing', async () => {
    const w = dockerWorld({ 'image inspect': { code: 1 } });
    await w.helper.start({ argv: ARGV });
    await w.helper.start({ argv: ARGV });
    expect(w.commands()).toEqual([
      'image inspect',
      'build --tag',
      'run --detach',
      'exec --interactive',
      'run --detach',
      'exec --interactive',
    ]);
    expect(w.calls[1]?.args).toEqual(['build', '--tag', TAG, '-']);
    expect(w.calls[1]?.child.input.join('')).toBe(DOCKERFILE);
    expect(w.logs.map((line) => line.msg)).toEqual(['building the sign-in image', 'built the sign-in image']);
  });

  it('says so when the image does not build, and tries the build again on the next sign-in', async () => {
    const w = dockerWorld({ 'image inspect': { code: 1 }, 'build --tag': { code: 1 } });
    await expect(w.helper.start({ argv: ARGV })).rejects.toThrow(LoginHelperError);
    await expect(w.helper.start({ argv: ARGV })).rejects.toThrow(/could not be built/);
    expect(w.commands().filter((command) => command === 'build --tag')).toHaveLength(2);
    expect(w.logs.at(-1)).toMatchObject({ msg: 'the sign-in image did not build', exitCode: 1, image: TAG });
  });

  it('says plainly that Docker is not available when it is not installed', async () => {
    const w = dockerWorld({ image: { missing: true } });
    await expect(w.helper.start({ argv: ARGV })).rejects.toThrow(/Docker is not available on this server/);
  });

  it('says so when the sandbox does not start', async () => {
    const w = dockerWorld({ 'run --detach': { code: 125 } });
    await expect(w.helper.start({ argv: ARGV })).rejects.toThrow(/sandbox did not start/);
  });

  it("reads a file of the sandbox's home with docker exec cat, undefined when it is not there", async () => {
    const w = dockerWorld({ 'exec mwc-login-test-1': { stdout: '{"tokens":{}}' } });
    const sandbox = await w.helper.start({ argv: ARGV });
    expect(await sandbox.readFile('.codex/auth.json')).toBe('{"tokens":{}}');
    expect(w.calls.at(-1)?.args).toEqual(sandboxReadArgs('mwc-login-test-1', '.codex/auth.json'));
    const missing = dockerWorld({ 'exec mwc-login-test-1': { code: 1 } });
    const empty = await missing.helper.start({ argv: ARGV });
    expect(await empty.readFile('.claude.json')).toBeUndefined();
  });

  it('runs a command of the CLI in the sandbox with docker exec, giving its exit code and output', async () => {
    const w = dockerWorld({ 'exec mwc-login-test-1': { stdout: 'gho_FAKE\n' } });
    const sandbox = await w.helper.start({ argv: ['gh', 'auth', 'login', '--web'], tty: false });
    expect(w.calls[2]?.args).toEqual([
      'exec',
      '--interactive',
      'mwc-login-test-1',
      'gh',
      'auth',
      'login',
      '--web',
    ]);
    expect(await sandbox.run(['gh', 'auth', 'token'])).toEqual({ code: 0, stdout: 'gho_FAKE\n' });
    expect(w.calls.at(-1)?.args).toEqual(sandboxCommandArgs('mwc-login-test-1', ['gh', 'auth', 'token']));
  });

  it('kills the login and removes the container with docker rm --force', async () => {
    const w = dockerWorld();
    const sandbox = await w.helper.start({ argv: ARGV });
    await sandbox.kill();
    expect(w.calls[2]?.child.signals).toEqual(['SIGKILL']);
    expect(w.calls.at(-1)?.args).toEqual(sandboxRemoveArgs('mwc-login-test-1'));
  });

  it('names each container at random by default', async () => {
    const { spawn, calls } = fakeSpawn((call) => {
      if (call.args[1] !== '--interactive') call.child.answer('', 0);
    });
    const helper = dockerLoginHelper({
      spawn,
      dockerfile: async () => DOCKERFILE,
      logger: captureLogger().logger,
      instance: INSTANCE,
    });
    await helper.start({ argv: ARGV });
    expect(calls[1]?.args[4]).toMatch(/^mwc-login-[0-9a-f]{12}$/);
  });
});

describe('the startup sweep', () => {
  it('lists the running containers carrying both labels and removes them by id, as plain arguments', () => {
    expect(sweepListArgs('api-9950')).toEqual([
      'ps',
      '--quiet',
      '--no-trunc',
      '--filter',
      'label=mwc.login-helper=1',
      '--filter',
      'label=mwc.instance=api-9950',
    ]);
    expect(sandboxRemoveArgs(ID_A, ID_B)).toEqual(['rm', '--force', ID_A, ID_B]);
    expect(containerIds(`${ID_A}\n${ID_B}\n\nWARNING: not an id\n`)).toEqual([ID_A, ID_B]);
  });

  it("removes this instance's leftover sandboxes with one docker rm --force, and says how many", async () => {
    const w = dockerWorld({ 'ps --quiet': { stdout: `${ID_A}\n${ID_B}\n` } });
    expect(await w.helper.sweep()).toBe(2);
    expect(w.calls.map((call) => call.args)).toEqual([
      sweepListArgs(INSTANCE),
      sandboxRemoveArgs(ID_A, ID_B),
    ]);
  });

  it('removes nothing when none is left, or when Docker is stopped or missing', async () => {
    for (const answer of [{ stdout: '' }, { code: 1 }, { missing: true }]) {
      const w = dockerWorld({ 'ps --quiet': answer });
      expect(await w.helper.sweep()).toBe(0);
      expect(w.commands()).toEqual(['ps --quiet']);
    }
  });

  it('warns when the leftovers could not be removed', async () => {
    const w = dockerWorld({ 'ps --quiet': { stdout: ID_A }, 'rm --force': { code: 1 } });
    expect(await w.helper.sweep()).toBe(0);
    expect(w.logs.at(-1)).toMatchObject({
      msg: 'left sign-in sandboxes were not removed',
      exitCode: 1,
      count: 1,
    });
  });

  it('refuses an instance label that a filter could read as more', () => {
    const deps = {
      spawn: fakeSpawn().spawn,
      dockerfile: async () => DOCKERFILE,
      logger: captureLogger().logger,
    };
    expect(() => dockerLoginHelper({ ...deps, instance: 'api-1,label=x' })).toThrow(RangeError);
    expect(() => dockerLoginHelper({ ...deps, instance: '' })).toThrow(RangeError);
  });
});
