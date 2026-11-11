import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeArtifactFs } from '../../../src/turns/artifacts/fs.ts';
import { tempDir } from '../../fixtures/runner.ts';

describe('nodeArtifactFs', () => {
  const fs = nodeArtifactFs();

  it('makes a folder with its parents and gives its real path; undefined when it cannot', () => {
    const root = tempDir();
    const made = fs.ensure(join(root, 'a', 'b'));
    expect(made).toBe(fs.realpath(join(root, 'a', 'b')));
    writeFileSync(join(root, 'file'), 'x');
    expect(fs.ensure(join(root, 'file', 'below'))).toBeUndefined();
    expect(fs.realpath(join(root, 'missing'))).toBeUndefined();
  });

  it('walks regular files breadth first, no deeper than asked, at most `max`, past hidden names and links', () => {
    const root = tempDir();
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(join(root, 'top.txt'), '1');
    writeFileSync(join(root, 'a', 'mid.txt'), '22');
    writeFileSync(join(root, 'a', 'b', 'c', 'deep.txt'), '333');
    writeFileSync(join(root, '.hidden'), 'h');
    symlinkSync(join(root, 'top.txt'), join(root, 'link.txt'));
    expect(fs.walk(root, 100, 6).map((e) => [e.path, e.size])).toEqual([
      ['top.txt', 1],
      ['a/mid.txt', 2],
      ['a/b/c/deep.txt', 3],
    ]);
    expect(fs.walk(root, 100, 1).map((e) => e.path)).toEqual(['top.txt', 'a/mid.txt']);
    // Every name looked at counts (hidden ones aside): `a`, `link.txt`, `top.txt`, then nothing more.
    expect(fs.walk(root, 3, 6).map((e) => e.path)).toEqual(['top.txt']);
    expect(fs.walk(join(root, 'missing'), 10, 6)).toEqual([]);
  });

  it('reads a file up to `max` bytes, never one longer, a folder, or a file through a link', () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.txt'), 'hello');
    symlinkSync(join(root, 'a.txt'), join(root, 'link.txt'));
    expect(Buffer.from(fs.read(join(root, 'a.txt'), 5) as Uint8Array).toString()).toBe('hello');
    expect(fs.read(join(root, 'a.txt'), 4)).toBeUndefined();
    expect(fs.read(join(root, 'link.txt'), 100)).toBeUndefined();
    expect(fs.read(root, 100)).toBeUndefined();
    expect(fs.read(join(root, 'none'), 100)).toBeUndefined();
  });
});
