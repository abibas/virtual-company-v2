import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { tarGz } from '../../src/install/tar.ts';
import { isSafePath, untarGz } from '../../src/update/untar.ts';

/** One ustar header block for `path` with a type flag and a size, as another tar would write it. */
function header(path: string, type: string, size = 0): Buffer {
  const block = Buffer.alloc(512);
  block.write(path, 0, 100);
  block.write('0000644\0', 100);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write(type, 156);
  block.write('ustar\0', 257);
  return block;
}

const archive = (...blocks: Buffer[]) => gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));

describe('reading the PTY archive', () => {
  it("reads back the build's archive: paths (long ones too), modes and bodies", () => {
    const long = `node_modules/@lydell/node-pty-darwin-arm64/${'deep/'.repeat(25)}pty.node`;
    const entries = [
      { path: 'node_modules/a/package.json', mode: 0o644, body: Buffer.from('{}') },
      { path: 'node_modules/a/spawn-helper', mode: 0o755, body: Buffer.alloc(700, 1) },
      { path: long, mode: 0o644, body: Buffer.alloc(0) },
    ];
    const read = untarGz(tarGz(entries));
    expect(read.map((entry) => [entry.path, entry.mode, Buffer.from(entry.body)])).toEqual(
      entries.map((entry) => [entry.path, entry.mode, entry.body]),
    );
  });

  it('reads a name that fills its whole field, and an empty number as 0', () => {
    const full = `node_modules/${'n'.repeat(87)}`;
    expect(full).toHaveLength(100);
    expect(untarGz(tarGz([{ path: full, mode: 0o644, body: Buffer.from('x') }]))[0]?.path).toBe(full);
    const blank = header('node_modules/y', '0');
    blank.fill(0, 100, 108);
    expect(untarGz(archive(blank))[0]?.mode).toBe(0);
  });

  it('skips folder entries and stops at the end blocks', () => {
    const files = untarGz(archive(header('node_modules/', '5'), header('node_modules/x', '0', 0)));
    expect(files.map((file) => file.path)).toEqual(['node_modules/x']);
    expect(untarGz(gzipSync(Buffer.alloc(0)))).toEqual([]);
  });

  it('refuses links, paths that leave their folder, bad numbers and an archive cut short', () => {
    expect(() => untarGz(archive(header('node_modules/l', '2')))).toThrow('an entry that is not a file');
    expect(() => untarGz(archive(header('../evil', '0')))).toThrow('a path that leaves its folder: ../evil');
    expect(() => untarGz(archive(header('/etc/passwd', '0')))).toThrow('a path that leaves its folder');
    const bad = header('node_modules/x', '0');
    bad.write('99999999999\0', 124);
    expect(() => untarGz(archive(bad))).toThrow('a bad number in the archive');
    const cut = gzipSync(Buffer.concat([header('node_modules/x', '0', 4096), Buffer.alloc(512)]));
    expect(() => untarGz(cut)).toThrow('the archive ends inside node_modules/x');
  });

  it('knows a safe relative path', () => {
    expect(isSafePath('node_modules/a/b')).toBe(true);
    expect(isSafePath('a/../b')).toBe(false);
    expect(isSafePath('')).toBe(false);
    expect(isSafePath('/a')).toBe(false);
  });
});
