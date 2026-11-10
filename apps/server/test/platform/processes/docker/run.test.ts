import { describe, expect, it } from 'vitest';
import { KEPT_LINES, KILL_GRACE_MS, runDocker } from '../../../../src/platform/processes/docker/run.ts';
import { fakeDockerSpawn, manualTimers } from '../../../fixtures/platform/processes.ts';

const DOCKER = '/usr/local/bin/docker';
const ENV = { PATH: '/usr/local/bin', HOME: '/Users/ihor' };

function setUp(pid: number | null = 4300) {
  const fake = fakeDockerSpawn(pid);
  const clock = manualTimers();
  const heard: string[] = [];
  const run = (args: readonly string[], timeoutMs = 60_000) =>
    runDocker({ spawn: fake.spawn, killGroup: fake.killGroup, timers: clock.timers }, DOCKER, args, {
      env: ENV,
      timeoutMs,
      onLine: (line) => heard.push(line),
    });
  return { fake, clock, heard, run };
}

describe('a docker command run to its end', () => {
  it('runs in its own group with its environment, keeps its stdout and passes on each line of both streams', async () => {
    const { fake, clock, heard, run } = setUp();
    const done = run(['compose', 'up']);
    expect(fake.spawned).toEqual([
      {
        file: DOCKER,
        args: ['compose', 'up'],
        options: { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: ENV },
      },
    ]);
    fake.stdout.emit('data', Buffer.from('[{"Id":'));
    fake.stdout.emit('data', Buffer.from('"ab"}]\n'));
    fake.stderr.emit('data', Buffer.from('#1 [internal] load\r#1 DONE 0.1s\n\n  #2 [runtime 1/6]  '));
    fake.child.emit('close', 0, null);
    expect(await done).toEqual({
      ok: true,
      stdout: '[{"Id":"ab"}]\n',
      lines: ['[{"Id":"ab"}]', '#1 [internal] load', '#1 DONE 0.1s', '#2 [runtime 1/6]'],
    });
    expect(heard).toHaveLength(4);
    expect(clock.pending()).toEqual([]);
  });

  it('fails with its last line, else its exit code or signal, keeping only the last lines', async () => {
    const one = setUp();
    const failed = one.run(['compose', 'up']);
    for (let n = 0; n < KEPT_LINES + 5; n++) one.fake.stderr.emit('data', `line ${n}\n`);
    one.fake.stderr.emit('data', `failed to solve: ${'x'.repeat(600)}`);
    one.fake.child.emit('close', 1, null);
    const result = await failed;
    expect(result.ok).toBe(false);
    expect(result.lines).toHaveLength(KEPT_LINES);
    expect(result.error).toBe(`failed to solve: ${'x'.repeat(483)}`);
    const quiet = setUp();
    const coded = quiet.run(['ps']);
    quiet.fake.child.emit('close', 125, null);
    expect((await coded).error).toBe('exit code 125');
    const killed = setUp();
    const signalled = killed.run(['ps']);
    killed.fake.child.emit('close', null, 'SIGKILL');
    expect((await signalled).error).toBe('ended by SIGKILL');
  });

  it("stops its group past the limit (SIGTERM, then SIGKILL) and says so; a child with no pid isn't signalled", async () => {
    const { fake, clock, run } = setUp();
    const slow = run(['compose', 'up'], 15 * 60_000);
    clock.fire(15 * 60_000);
    expect(fake.kills).toEqual(['4300 SIGTERM']);
    clock.fire(KILL_GRACE_MS);
    expect(fake.kills).toEqual(['4300 SIGTERM', '4300 SIGKILL']);
    fake.child.emit('close', null, 'SIGKILL');
    expect(await slow).toMatchObject({ ok: false, error: 'it did not end within 15 minutes' });
    const quick = setUp(null);
    const short = quick.run(['inspect', 'x'], 30_000);
    quick.clock.fire(30_000);
    expect(quick.fake.kills).toEqual([]);
    quick.fake.child.emit('close', null, null);
    expect((await short).error).toBe('it did not end within 30 s');
  });

  it('fails when it cannot start or errors, once', async () => {
    const { fake, run } = setUp();
    const erred = run(['ps']);
    fake.child.emit('error', new Error('spawn docker ENOENT'));
    fake.child.emit('close', 0, null);
    expect(await erred).toMatchObject({ ok: false, error: 'spawn docker ENOENT' });
    const timers = manualTimers().timers;
    const throwing = (message: unknown) =>
      runDocker(
        {
          spawn: () => {
            throw message;
          },
          killGroup: () => {},
          timers,
        },
        DOCKER,
        ['ps'],
        { env: ENV, timeoutMs: 1000 },
      );
    expect(await throwing(new Error('EACCES'))).toEqual({
      ok: false,
      stdout: '',
      lines: [],
      error: 'EACCES',
    });
    expect((await throwing('odd')).error).toBe('odd');
  });

  it('runs without a listener for its lines', async () => {
    const fake = fakeDockerSpawn();
    const done = runDocker(
      { spawn: fake.spawn, killGroup: fake.killGroup, timers: manualTimers().timers },
      DOCKER,
      ['ps'],
      { env: ENV, timeoutMs: 1000 },
    );
    fake.stdout.emit('data', 'abc123def456\n');
    fake.child.emit('close', 0, null);
    expect((await done).lines).toEqual(['abc123def456']);
  });
});
