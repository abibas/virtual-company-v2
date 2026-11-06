import { describe, expect, it } from 'vitest';
import { runCommand } from '../../src/system/process.ts';
import { FakeSpawn } from '../fixtures/spawn.ts';
import { FakeTime } from '../fixtures/time.ts';

describe('runCommand', () => {
  it('starts the program with stdout piped and collects its output until it closes', async () => {
    const spawn = new FakeSpawn().when('/usr/sbin/sysctl', (child) => {
      child.stdout?.write('6');
      child.finish('2\n');
    });
    const result = await runCommand('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level'], {
      spawn: spawn.spawn,
      timers: new FakeTime(),
    });
    expect(result).toEqual({ code: 0, stdout: '62\n' });
    expect(spawn.calls[0]).toMatchObject({
      file: '/usr/sbin/sysctl',
      args: ['-n', 'kern.memorystatus_level'],
      options: { stdio: ['ignore', 'pipe', 'ignore'] },
    });
  });

  it('reports a non-zero exit, a kill, a start failure and a spawn that throws', async () => {
    const time = new FakeTime();
    const spawn = new FakeSpawn()
      .when('/bin/false', (child) => child.finish('', 1))
      .when('/bin/killed', (child) => child.exit(null, 'SIGTERM'))
      .when('/bin/killed-somehow', (child) => child.exit(null))
      .when('/bin/missing', (child) => child.fail('spawn /bin/missing ENOENT'));
    spawn.throwsFor.add('/bin/throws');
    const run = (file: string) => runCommand(file, [], { spawn: spawn.spawn, timers: time });
    expect(await run('/bin/false')).toEqual({ code: 1, stdout: '' });
    expect(await run('/bin/killed')).toEqual({ code: null, stdout: '', error: 'killed by SIGTERM' });
    expect(await run('/bin/killed-somehow')).toEqual({ code: null, stdout: '', error: 'killed by a signal' });
    expect(await run('/bin/missing')).toEqual({ code: null, stdout: '', error: 'spawn /bin/missing ENOENT' });
    expect(await run('/bin/throws')).toEqual({ code: null, stdout: '', error: 'cannot start /bin/throws' });
    expect(time.pending).toEqual([]);
  });

  it('kills a program that runs too long (10 s by default)', async () => {
    const time = new FakeTime();
    const spawn = new FakeSpawn();
    const pending = runCommand('/usr/local/bin/devbox-keepalive', ['20 minutes'], {
      spawn: spawn.spawn,
      timers: time,
    });
    expect(time.pending).toEqual([10_000]);
    await time.advance(10_000);
    expect(await pending).toEqual({ code: null, stdout: '', error: 'timed out after 10000 ms' });
    expect(spawn.calls[0]?.child.signals).toEqual(['SIGKILL']);

    const quick = runCommand('/bin/sleep', [], { spawn: spawn.spawn, timers: time, timeoutMs: 50 });
    await time.advance(50);
    expect((await quick).error).toBe('timed out after 50 ms');
  });
});
