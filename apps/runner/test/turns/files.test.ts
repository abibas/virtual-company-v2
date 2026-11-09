import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { tempDir } from '../fixtures/runner.ts';

describe("the private folders' file system", () => {
  it('reads, writes with a mode, renames and removes on Node’s file system', () => {
    const fs = nodePrivateFs();
    const dir = join(tempDir(), 'a', 'b');
    expect(fs.isDirectory(dir)).toBe(false);
    fs.mkdir(dir);
    expect(fs.isDirectory(dir)).toBe(true);
    const file = join(dir, 'f');
    expect(fs.read(file)).toBeUndefined();
    writeFileSync(file, 'old', { mode: 0o644 });
    fs.write(file, 'new', 0o600);
    expect([fs.read(file), statSync(file).mode & 0o777]).toEqual(['new', 0o600]);
    expect(fs.isDirectory(file)).toBe(false);
    fs.rename(file, `${file}2`);
    expect([fs.exists(file), fs.exists(`${file}2`)]).toEqual([false, true]);
    fs.remove(`${file}2`);
    fs.remove(`${file}2`);
    expect(fs.exists(`${file}2`)).toBe(false);
  });
});
