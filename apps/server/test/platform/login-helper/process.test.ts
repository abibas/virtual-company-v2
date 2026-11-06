import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { SandboxExit } from '../../../src/platform/login-helper/port.ts';
import { childSandbox, runCommand, spawnFailure } from '../../../src/platform/login-helper/process.ts';
import { FakeChild, fakeSpawn } from '../../fixtures/credentials/sign-in/child.ts';
import { settle } from '../../fixtures/credentials/sign-in/helper.ts';

const parts = (files: Record<string, string> = {}) => ({
  readFile: vi.fn(async (path: string) => files[path]),
  dispose: vi.fn(async () => {}),
  notFound: 'The tool is missing',
});

const sandboxOf = (child: FakeChild, p = parts()) => childSandbox(child as unknown as ChildProcess, p);

describe('childSandbox', () => {
  it('decodes stdout and stderr as UTF-8, keeping chunks for the first listener and splitting no character', async () => {
    const child = new FakeChild();
    const sandbox = sandboxOf(child);
    const euro = Buffer.from('€');
    child.stdout.write(Buffer.from('Opening '));
    child.stdout.write(euro.subarray(0, 1));
    await settle();
    const seen: string[] = [];
    sandbox.onOutput((chunk) => seen.push(chunk));
    child.stdout.write(euro.subarray(1));
    child.stderr.write('warning\n');
    await settle();
    expect(seen.join('')).toBe('Opening €warning\n');
    const later: string[] = [];
    sandbox.onOutput((chunk) => later.push(chunk));
    child.stdout.write('more');
    await settle();
    expect(later).toEqual(['more']);
  });

  it('reports the exit once, also to a listener added after it, and drops input once stopped', async () => {
    const child = new FakeChild();
    const sandbox = sandboxOf(child);
    const exits: SandboxExit[] = [];
    sandbox.onExit((exit) => exits.push(exit));
    sandbox.write('typed\r');
    child.emit('close', 0);
    child.emit('close', 1);
    sandbox.write('after');
    sandbox.onExit((exit) => exits.push(exit));
    expect(exits).toEqual([{ code: 0 }, { code: 0 }]);
    await settle();
    expect(child.input).toEqual(['typed\r']);
  });

  it('says why the program did not run, in plain words, never its error text', () => {
    const child = new FakeChild();
    const sandbox = sandboxOf(child);
    const exits: SandboxExit[] = [];
    sandbox.onExit((exit) => exits.push(exit));
    child.emit('error', Object.assign(new Error('spawn docker ENOENT /usr/secret/path'), { code: 'ENOENT' }));
    child.emit('close', null);
    expect(exits).toEqual([{ code: null, error: 'The tool is missing' }]);
    expect(spawnFailure(Object.assign(new Error('EACCES /x'), { code: 'EACCES' }), 'missing')).toBe(
      'The sign-in helper could not start',
    );
    expect(spawnFailure(undefined, 'missing')).toBe('The sign-in helper could not start');
  });

  it('swallows a write that races the exit (EPIPE on stdin)', () => {
    const child = new FakeChild();
    sandboxOf(child);
    expect(() => child.stdin.emit('error', new Error('write EPIPE'))).not.toThrow();
  });

  it('reads only plain paths under the home', async () => {
    const p = parts({ '.codex/auth.json': '{}' });
    const sandbox = sandboxOf(new FakeChild(), p);
    expect(await sandbox.readFile('.codex/auth.json')).toBe('{}');
    expect(await sandbox.readFile('.claude.json')).toBeUndefined();
    expect(() => sandbox.readFile('../../etc/passwd')).toThrow(RangeError);
    expect(p.readFile).toHaveBeenCalledTimes(2);
  });

  it('kills a running CLI with SIGKILL and disposes of the sandbox once, however often it is called', async () => {
    const child = new FakeChild();
    const p = parts();
    const sandbox = sandboxOf(child, p);
    const first = sandbox.kill();
    expect(sandbox.kill()).toBe(first);
    await first;
    expect(child.signals).toEqual(['SIGKILL']);
    expect(p.dispose).toHaveBeenCalledTimes(1);
  });

  it('only disposes of the sandbox when the CLI has already stopped', async () => {
    const child = new FakeChild();
    const p = parts();
    const sandbox = sandboxOf(child, p);
    child.emit('close', 0);
    await sandbox.kill();
    expect(child.signals).toEqual([]);
    expect(p.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('runCommand', () => {
  it('writes the input, closes stdin and gives the exit code and standard output', async () => {
    const { spawn, calls } = fakeSpawn((call) => call.child.answer('sha256:abc\n', 0));
    const result = await runCommand(spawn, 'docker', ['build', '-'], {
      input: 'FROM node',
      timeoutMs: 1000,
      notFound: 'no docker',
    });
    expect(result).toEqual({ code: 0, stdout: 'sha256:abc\n' });
    expect(calls[0]?.command).toBe('docker');
    expect(calls[0]?.args).toEqual(['build', '-']);
    expect(calls[0]?.options).toEqual({ stdio: 'pipe' });
    expect(calls[0]?.child.input.join('')).toBe('FROM node');
    expect(calls[0]?.child.stdinEnded).toBe(true);
  });

  it('says plainly when the program is missing', async () => {
    const { spawn } = fakeSpawn((call) => call.child.failToStart());
    expect(await runCommand(spawn, 'docker', ['ps'], { timeoutMs: 1000, notFound: 'no docker' })).toEqual({
      code: null,
      stdout: '',
      error: 'no docker',
    });
  });

  it('stops a command that takes too long', async () => {
    const { spawn, calls } = fakeSpawn((call) => {
      call.child.kill = (signal: string) => {
        call.child.signals.push(signal);
        call.child.emit('close', null);
        return true;
      };
    });
    expect(await runCommand(spawn, 'docker', ['exec'], { timeoutMs: 5, notFound: 'x' })).toEqual({
      code: null,
      stdout: '',
    });
    expect(calls[0]?.child.signals).toEqual(['SIGKILL']);
  });

  it('keeps at most 4 MiB of standard output', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024);
    const { spawn } = fakeSpawn((call) =>
      setImmediate(() => {
        call.child.stdout.write(big);
        call.child.answer('and more', 0);
      }),
    );
    const result = await runCommand(spawn, 'docker', ['exec'], { timeoutMs: 1000, notFound: 'x' });
    expect(result.stdout.length).toBeLessThan(big.length + 'and more'.length);
    expect(result.stdout.startsWith('xxxx')).toBe(true);
  });
});
