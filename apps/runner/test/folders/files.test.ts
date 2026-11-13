import { mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeFoldersFs } from '../../src/folders/files.ts';
import { tempDir } from '../fixtures/runner.ts';

describe("the folder browser's file system", () => {
  it('tells folders, lists entries with links to folders as folders, checks existence and makes one folder 0755', async () => {
    const fs = nodeFoldersFs();
    const dir = tempDir();
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'f'), 'x');
    symlinkSync(join(dir, 'a'), join(dir, 'to-a'));
    symlinkSync(join(dir, 'gone'), join(dir, 'broken'));
    expect([await fs.isDirectory(join(dir, 'a')), await fs.isDirectory(join(dir, 'f'))]).toEqual([
      true,
      false,
    ]);
    await expect(fs.isDirectory(join(dir, 'nope'))).rejects.toMatchObject({ code: 'ENOENT' });
    const entries = [...(await fs.readdir(dir))].sort((x, y) => x.name.localeCompare(y.name));
    expect(entries).toEqual([
      { name: 'a', directory: true },
      { name: 'broken', directory: false },
      { name: 'f', directory: false },
      { name: 'to-a', directory: true },
    ]);
    expect(await fs.realpath(join(dir, 'to-a'))).toBe(await fs.realpath(join(dir, 'a')));
    expect([await fs.exists(join(dir, 'f')), await fs.exists(join(dir, 'nope'))]).toEqual([true, false]);
    await fs.mkdir(join(dir, 'a', 'b'));
    expect(statSync(join(dir, 'a', 'b')).isDirectory()).toBe(true);
    await expect(fs.mkdir(join(dir, 'a', 'b'))).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(fs.mkdir(join(dir, 'x', 'y'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('makes a folder with its missing parents, each 0755 at most, and takes one already there', async () => {
    const fs = nodeFoldersFs();
    const dir = tempDir();
    await fs.mkdirp(join(dir, 'p', 'q', 'r'));
    await fs.mkdirp(join(dir, 'p', 'q', 'r'));
    for (const folder of [join(dir, 'p'), join(dir, 'p', 'q', 'r')]) {
      expect(statSync(folder).mode & 0o777 & ~0o755).toBe(0);
      expect(statSync(folder).mode & 0o700).toBe(0o700);
    }
    writeFileSync(join(dir, 'file'), 'x');
    await expect(fs.mkdirp(join(dir, 'file'))).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
