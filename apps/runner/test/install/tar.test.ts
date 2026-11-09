import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { splitPath, TAR_MTIME, tarGz } from '../../src/install/tar.ts';

const field = (block: Buffer, start: number, length: number) =>
  block
    .subarray(start, start + length)
    .toString()
    .replace(/\0.*$/s, '');

describe('the tar writer', () => {
  it('writes ustar headers (name, mode, size, time, checksum), padded bodies and the two end blocks', () => {
    const body = Buffer.from('#!/bin/sh\necho hi\n');
    const tar = gunzipSync(tarGz([{ path: 'pkg/bin/run', mode: 0o100755, body }]));
    expect(tar.length).toBe(512 + 512 + 1024);
    const header = tar.subarray(0, 512);
    expect(field(header, 0, 100)).toBe('pkg/bin/run');
    expect(field(header, 100, 8)).toBe('0000755');
    expect(Number.parseInt(field(header, 124, 12), 8)).toBe(body.length);
    expect(Number.parseInt(field(header, 136, 12), 8)).toBe(TAR_MTIME);
    expect(field(header, 156, 1)).toBe('0');
    expect(field(header, 257, 6)).toBe('ustar');
    const sum = [...header].reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    expect(Number.parseInt(field(header, 148, 8), 8)).toBe(sum);
    expect(tar.subarray(512, 512 + body.length).equals(body)).toBe(true);
    expect(tar.subarray(512 + body.length).every((byte) => byte === 0)).toBe(true);
  });

  it('needs no padding for a body of whole blocks, and keeps an empty file', () => {
    const tar = gunzipSync(
      tarGz([
        { path: 'a', mode: 0o644, body: Buffer.alloc(512, 1) },
        { path: 'b', mode: 0o644, body: Buffer.alloc(0) },
      ]),
    );
    expect(tar.length).toBe(512 + 512 + 512 + 1024);
    expect(field(tar.subarray(1024, 1536), 0, 100)).toBe('b');
  });

  it('puts the start of a long path in the prefix, and refuses one that cannot fit', () => {
    const long = `node_modules/${'x'.repeat(90)}/prebuilds/linux-x64/pty.node`;
    expect(splitPath('short/name')).toEqual({ prefix: '', name: 'short/name' });
    expect(splitPath(long)).toEqual({
      prefix: `node_modules/${'x'.repeat(90)}`,
      name: 'prebuilds/linux-x64/pty.node',
    });
    const header = gunzipSync(tarGz([{ path: long, mode: 0o644, body: Buffer.alloc(1) }])).subarray(0, 512);
    expect(field(header, 345, 155)).toBe(`node_modules/${'x'.repeat(90)}`);
    expect(() => splitPath(`${'y'.repeat(160)}/${'z'.repeat(101)}`)).toThrow(
      'A path too long for a tar archive',
    );
    expect(() => splitPath('w'.repeat(101))).toThrow('A path too long');
  });
});
