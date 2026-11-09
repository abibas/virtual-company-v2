import { readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec, nodeFs, nodeHost } from '../../src/install/system.ts';
import { readRunnerVersion } from '../../src/system/node.ts';
import { executable } from '../fixtures/host.ts';
import { tempDir } from '../fixtures/runner.ts';

const mode = (path: string) => statSync(path).mode & 0o777;

describe('the real machine behind the commands', () => {
  it('reads, writes, copies, renames and removes files with the modes asked for', () => {
    const dir = tempDir();
    const folder = join(dir, 'a', 'b');
    nodeFs.mkdir(folder, 0o700);
    expect(mode(folder)).toBe(0o700);
    const file = join(folder, 'unit');
    nodeFs.writeFile(file, 'one', 0o600);
    nodeFs.writeFile(file, 'two', 0o644);
    expect(nodeFs.readFile(file)).toBe('two');
    expect(mode(file)).toBe(0o644);
    const copy = join(dir, 'copy.mjs');
    writeFileSync(copy, 'old');
    nodeFs.copyFile(file, copy);
    expect([readFileSync(copy, 'utf8'), mode(copy)]).toEqual(['two', 0o644]);
    expect(nodeFs.exists(copy)).toBe(true);
    const bytes = join(dir, 'new.tmp');
    nodeFs.writeBytes(bytes, new Uint8Array([1, 2, 3]), 0o644);
    expect(() => nodeFs.writeBytes(bytes, new Uint8Array([4]), 0o644)).toThrow(/EEXIST/);
    nodeFs.rename(bytes, copy);
    expect([[...nodeFs.readBytes(copy)], mode(copy), nodeFs.exists(bytes)]).toEqual([
      [1, 2, 3],
      0o644,
      false,
    ]);
    nodeFs.remove(join(dir, 'a'));
    nodeFs.remove(join(dir, 'a'));
    expect(nodeFs.exists(file)).toBe(false);
  });

  it('knows an executable file from a plain one, a folder and nothing', () => {
    const dir = tempDir();
    const program = executable(dir, 'claude');
    writeFileSync(join(dir, 'notes'), '');
    expect(nodeFs.isExecutable(program)).toBe(true);
    expect(nodeFs.isExecutable(join(dir, 'notes'))).toBe(false);
    expect(nodeFs.isExecutable(dir)).toBe(false);
    expect(nodeFs.isExecutable(join(dir, 'none'))).toBe(false);
  });

  it('runs a program to its end, with its exit code, or says why it could not', async () => {
    expect(await nodeExec('/usr/bin/true', [])).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await nodeExec('/usr/bin/false', [], { env: { PATH: '/usr/bin' } })).toMatchObject({ code: 1 });
    const missing = await nodeExec(join(tempDir(), 'none'), ['--version']);
    expect(missing).toMatchObject({ code: null, error: expect.stringContaining('ENOENT') });
  });

  it("hands the commands the process, Node's os and fetch", async () => {
    const host = nodeHost();
    expect(host.env).toBe(process.env);
    expect([host.platform, host.arch, host.execPath]).toEqual([
      process.platform,
      process.arch,
      process.execPath,
    ]);
    expect(host.selfPath).toBe(process.argv[1]);
    expect(host.uid).toBe(process.getuid?.());
    expect(host.version).toBe(readRunnerVersion());
    expect([host.hostname(), host.homedir(), host.username()]).toEqual([
      os.hostname(),
      os.homedir(),
      os.userInfo().username,
    ]);
    expect(host.fs).toBe(nodeFs);
    expect(host.exec).toBe(nodeExec);
    await expect(host.fetch('http://127.0.0.1:1/')).rejects.toThrow();
    await host.sleep(1);
    host.out('');
    host.err('');
  });
});
