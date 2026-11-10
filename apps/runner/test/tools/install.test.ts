import { TOOL_OUTPUT_LINE_MAX, TOOL_OUTPUT_LINES_MAX } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { npmEnv, npmInstallArgs, OUTPUT_CUT, startNpmInstall } from '../../src/tools/install.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime, settle } from '../fixtures/time.ts';

const NPM = '/Users/ihor/.nvm/versions/node/v24.21.0/bin/npm';
const HOME = '/Users/ihor';
const ENV = { HOME, PATH: '/usr/bin:/bin', MWC_RUNNER_CONFIG: '/x/runner.json', EMPTY: undefined };

/** An install of Codex on a fake spawn and fake time, its lines kept. */
function install(spawn: FakeSpawn, time = new FakeTime(), timeoutMs?: number) {
  const lines: string[] = [];
  const args = npmInstallArgs('codex', '0.163.0', HOME);
  const deps = {
    spawn: spawn.spawn,
    killGroup: spawn.killGroup,
    timers: time,
    line: (l: string) => lines.push(l),
  };
  const run = startNpmInstall(NPM, args, { env: ENV, cwd: HOME }, timeoutMs ? { ...deps, timeoutMs } : deps);
  return { run, lines, time };
}

describe('npm install of a CLI', () => {
  it('installs the pinned package under ~/.local with the npm beside the runner’s Node, in its own group', async () => {
    expect(npmInstallArgs('claude', '2.1.308', HOME)).toEqual([
      'install',
      '-g',
      '--prefix',
      '/Users/ihor/.local',
      '@anthropic-ai/claude-code@2.1.308',
    ]);
    const spawn = new FakeSpawn().when(NPM, (child) => {
      child.stdout?.write('\nadded 2 packages in 4s\r\n');
      child.printErr('npm warn deprecated something\nlast words');
      child.exit(0);
    });
    const { run, lines } = install(spawn);
    expect(await run.done).toEqual({ ok: true });
    const [call] = spawn.of(NPM);
    expect(call?.args).toEqual(['install', '-g', '--prefix', '/Users/ihor/.local', '@openai/codex@0.163.0']);
    expect(call?.options).toEqual({
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      cwd: HOME,
      env: { HOME, PATH: '/Users/ihor/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin' },
    });
    expect(lines).toEqual(['added 2 packages in 4s', 'npm warn deprecated something', 'last words']);
  });

  it('keeps the environment less MWC_* and unset values, with npm’s folder first on the PATH', () => {
    expect(npmEnv(NPM, { PATH: undefined, A: 'b' })).toEqual({
      A: 'b',
      PATH: '/Users/ihor/.nvm/versions/node/v24.21.0/bin',
    });
  });

  it('cuts long lines, and after the most lines sends one notice and nothing more', async () => {
    const many = Array.from({ length: TOOL_OUTPUT_LINES_MAX + 20 }, (_, i) => `line ${i}`);
    const spawn = new FakeSpawn().when(NPM, (child) => {
      child.stdout?.write(`${'x'.repeat(TOOL_OUTPUT_LINE_MAX + 50)}\n${many.join('\n')}\n`);
      child.exit(0);
    });
    const { run, lines } = install(spawn);
    await run.done;
    expect(lines).toHaveLength(TOOL_OUTPUT_LINES_MAX + 1);
    expect(lines[0]).toBe('x'.repeat(TOOL_OUTPUT_LINE_MAX));
    expect(lines.at(-1)).toBe(OUTPUT_CUT);
  });

  it('fails with npm’s exit code and its last line, or the signal that ended it', async () => {
    const spawn = new FakeSpawn().when(NPM, (child) => {
      child.printErr('npm error code EACCES\nnpm error path /Users/ihor/.local/lib\n');
      child.exit(243);
    });
    expect(await install(spawn).run.done).toEqual({
      ok: false,
      error: 'failed: npm exited with code 243 (npm error path /Users/ihor/.local/lib)',
    });
    const killed = new FakeSpawn().when(NPM, (child) => child.exit(null, 'SIGTERM'));
    expect(await install(killed).run.done).toEqual({ ok: false, error: 'failed: npm was ended by SIGTERM' });
    const silent = new FakeSpawn().when(NPM, (child) => child.exit(null));
    expect(await install(silent).run.done).toEqual({ ok: false, error: 'failed: npm was ended by a signal' });
  });

  it('fails when npm cannot start, either way', async () => {
    const throws = new FakeSpawn();
    throws.throwsFor.add(NPM);
    const thrown = install(throws);
    expect(await thrown.run.done).toEqual({ ok: false, error: `failed: cannot start ${NPM}` });
    thrown.run.kill();
    expect(throws.groupKills).toEqual([]);
    const missing = new FakeSpawn().when(NPM, (child) => child.fail('spawn EACCES'));
    expect(await install(missing).run.done).toEqual({ ok: false, error: 'failed: spawn EACCES' });
  });

  it('kills npm’s group after 10 minutes, and when told to', async () => {
    const spawn = new FakeSpawn();
    spawn.when(NPM, (child) => {
      child.dies = false;
    });
    const { run, time } = install(spawn);
    await settle();
    await time.advance(10 * 60_000 - 1);
    expect(spawn.groupKills).toEqual([]);
    await time.advance(1);
    expect(await run.done).toEqual({ ok: false, error: 'timeout: npm did not finish within 10 minutes' });
    expect(spawn.groupKills).toEqual([{ pid: 4000, signal: 'SIGKILL' }]);
    const stopped = new FakeSpawn();
    const second = install(stopped, new FakeTime(), 60_000);
    second.run.kill();
    expect(await second.run.done).toEqual({ ok: false, error: 'failed: npm was ended by SIGKILL' });
    expect(stopped.groupKills).toEqual([{ pid: 4000, signal: 'SIGKILL' }]);
  });
});
