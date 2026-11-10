import { describe, expect, it } from 'vitest';
import { FileFollower } from '../../src/follow/file.ts';
import { memoryRollouts } from '../fixtures/rollout.ts';

const PATH = '/home/sessions/2026/11/10/rollout-x-t.jsonl';

describe('FileFollower', () => {
  it('gives only the whole lines written since the last read, from its offset', () => {
    const files: Record<string, string> = { [PATH]: 'old\n' };
    const { fs, readsAt } = memoryRollouts(files);
    const file = new FileFollower(fs, PATH, 4);
    expect(file.read(1024)).toEqual({ lines: [], bytes: 0 });
    files[PATH] += 'one\ntwo\r\n';
    expect(file.read(1024)).toEqual({ lines: ['one', 'two'], bytes: 9 });
    expect(file.offset).toBe(13);
    expect(readsAt.map(([, offset, bytes]) => [offset, bytes])).toEqual([
      [4, 1024],
      [4, 1024],
    ]);
  });

  it('keeps a line still being written for the next read, and decodes only whole lines', () => {
    const files: Record<string, string> = { [PATH]: '{"a":1}\n{"b":"✓' };
    const { fs } = memoryRollouts(files);
    const file = new FileFollower(fs, PATH, 0);
    expect(file.read(1024)).toEqual({ lines: ['{"a":1}'], bytes: 17 });
    expect(file.offset).toBe(8);
    expect(file.read(1024)).toEqual({ lines: [], bytes: 9 });
    files[PATH] += '"}\n';
    expect(file.read(1024)).toEqual({ lines: ['{"b":"✓"}'], bytes: 12 });
  });

  it('waits for a line a read cut short, when it is no longer than the longest kept', () => {
    const { fs } = memoryRollouts({ [PATH]: 'a line\n' });
    const file = new FileFollower(fs, PATH, 0, 10);
    expect(file.read(4)).toEqual({ lines: [], bytes: 4 });
    expect(file.read(10)).toEqual({ lines: ['a line'], bytes: 7 });
  });

  it('skips a line longer than the longest kept, then reads on after it', () => {
    const long = 'x'.repeat(30);
    const { fs } = memoryRollouts({ [PATH]: `${long}\nnext\n` });
    const file = new FileFollower(fs, PATH, 0, 10);
    expect(file.read(10)).toEqual({ lines: [], bytes: 10 });
    expect(file.read(10)).toEqual({ lines: [], bytes: 10 });
    expect(file.read(10).lines).toEqual([]);
    expect(file.read(10)).toEqual({ lines: ['next'], bytes: 6 });
  });

  it('reads a file that shrank (replaced) from its start, and nothing from one it cannot read or for no bytes', () => {
    const files: Record<string, string> = { [PATH]: 'a long first line\n' };
    const { fs } = memoryRollouts(files);
    const file = new FileFollower(fs, PATH, 18);
    files[PATH] = 'new\n';
    expect(file.read(1024).lines).toEqual([]);
    expect(file.read(1024).lines).toEqual(['new']);
    expect(file.read(0)).toEqual({ lines: [], bytes: 0 });
    expect(new FileFollower(fs, '/missing', 0).read(1024)).toEqual({ lines: [], bytes: 0 });
  });
});
