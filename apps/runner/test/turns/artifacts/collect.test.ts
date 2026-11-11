import { createHash } from 'node:crypto';
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_LIMITS } from '@mwc/shared/flows';
import { describe, expect, it } from 'vitest';
import {
  ArtifactCollector,
  type ArtifactEntry,
  type ArtifactFs,
  artifactFrames,
  fileFrames,
} from '../../../src/turns/artifacts/collect.ts';
import { nodeArtifactFs } from '../../../src/turns/artifacts/fs.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { tempDir } from '../../fixtures/runner.ts';

const DIR = 'tasks/T-12/artifacts/1-develop/round-1';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** An agent folder on the real file system, with its outputs folder opened. */
function opened() {
  const cwd = tempDir();
  const logs = memoryLog();
  const collector = ArtifactCollector.open(nodeArtifactFs(), cwd, DIR, logs.log);
  return { cwd, folder: join(cwd, DIR), collector: collector as ArtifactCollector, logs };
}

/** A file system of sizes only: each file's bytes are its size of `a`, or `bytes` when given. */
function sizedFs(files: Record<string, number | Buffer>): ArtifactFs {
  const entries = (): ArtifactEntry[] =>
    Object.entries(files).map(([path, value]) => ({
      path,
      size: typeof value === 'number' ? value : value.length,
      mtimeMs: 1,
    }));
  let opened = false;
  return {
    ensure: (dir) => dir,
    realpath: (path) => path,
    walk: () => {
      if (opened) return entries();
      opened = true;
      return [];
    },
    read: (path, max) => {
      const value = files[path.slice(path.indexOf(DIR) + DIR.length + 1)];
      const bytes = typeof value === 'number' ? Buffer.alloc(value, 0x61) : value;
      return bytes === undefined || bytes.length > max ? undefined : new Uint8Array(bytes);
    },
    stat: (path) => {
      const value = files[path.slice(path.indexOf(DIR) + DIR.length + 1)];
      if (value === undefined) return undefined;
      return { kind: 'file', size: typeof value === 'number' ? value : value.length, mtimeMs: 1 };
    },
  };
}

describe('ArtifactCollector', () => {
  it('makes the folder, notes what is there, and collects only what is new or changed, typed', () => {
    const { folder, cwd } = opened();
    writeFileSync(join(folder, 'old.md'), 'before');
    const again = ArtifactCollector.open(nodeArtifactFs(), cwd, DIR, memoryLog().log);
    writeFileSync(join(folder, 'notes.md'), '# Notes');
    mkdirSync(join(folder, 'shots'));
    writeFileSync(join(folder, 'shots', 'login.png'), PNG);
    const { files, skipped } = (again as ArtifactCollector).collect();
    expect(files.map((f) => [f.path, f.contentType, f.bytes.length])).toEqual([
      ['notes.md', 'text/markdown; charset=utf-8', 7],
      ['shots/login.png', 'image/png', 12],
    ]);
    expect(files[0]?.sha256).toBe(createHash('sha256').update('# Notes').digest('hex'));
    expect(skipped).toEqual([]);
  });

  it('collects a file changed since, and passes over hidden names and links', () => {
    const { folder, cwd } = opened();
    writeFileSync(join(folder, 'notes.md'), 'one');
    const collector = ArtifactCollector.open(
      nodeArtifactFs(),
      cwd,
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    writeFileSync(join(folder, 'notes.md'), 'one, two');
    utimesSync(join(folder, 'notes.md'), new Date(), new Date(Date.now() + 5000));
    writeFileSync(join(folder, '.DS_Store'), Buffer.from([0, 1, 2]));
    mkdirSync(join(folder, '.git'));
    writeFileSync(join(folder, '.git', 'HEAD'), 'ref');
    writeFileSync(join(cwd, 'secret.txt'), 'secret');
    symlinkSync(join(cwd, 'secret.txt'), join(folder, 'link.txt'));
    expect(collector.collect().files.map((f) => f.path)).toEqual(['notes.md']);
  });

  it('lists a binary file as skipped', () => {
    const { folder, collector } = opened();
    writeFileSync(join(folder, 'build.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));
    expect(collector.collect()).toEqual({
      files: [],
      skipped: [{ path: 'build.zip', size: 6, reason: 'binary' }],
    });
  });

  it('refuses a folder that leads outside the home folder, and one it cannot make', () => {
    const cwd = tempDir();
    const outside = tempDir();
    symlinkSync(outside, join(cwd, 'tasks'));
    const logs = memoryLog();
    expect(ArtifactCollector.open(nodeArtifactFs(), cwd, DIR, logs.log)).toBeUndefined();
    writeFileSync(join(cwd, 'blocked'), 'a file');
    expect(ArtifactCollector.open(nodeArtifactFs(), cwd, 'blocked/inside', logs.log)).toBeUndefined();
    expect(
      logs.entries.filter((e) => e.msg === 'the outputs folder cannot be used; nothing is collected'),
    ).toHaveLength(2);
  });

  it('keeps to the limits: 20 files, 2 MB each, 10 MB together, the rest skipped with why', () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 4; i++) files[`big-${i}.txt`] = ARTIFACT_LIMITS.fileBytes;
    files['big-4.txt'] = ARTIFACT_LIMITS.fileBytes - 100;
    files['huge.txt'] = ARTIFACT_LIMITS.fileBytes + 1;
    files['more.txt'] = 200;
    const small = (i: number) => `small-${String(i).padStart(2, '0')}.txt`;
    for (let i = 0; i < 20; i++) files[small(i)] = 1;
    const collector = ArtifactCollector.open(
      sizedFs(files),
      '/home',
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    const { files: kept, skipped } = collector.collect();
    expect(kept.map((f) => f.path)).toEqual([
      ...[0, 1, 2, 3, 4].map((i) => `big-${i}.txt`),
      ...Array.from({ length: 15 }, (_, i) => small(i)),
    ]);
    expect(skipped).toEqual([
      { path: 'huge.txt', size: ARTIFACT_LIMITS.fileBytes + 1, reason: 'too_large' },
      { path: 'more.txt', size: 200, reason: 'total_limit' },
      ...[15, 16, 17, 18, 19].map((i) => ({ path: small(i), size: 1, reason: 'too_many' })),
    ]);
  });

  it('lists a file it cannot read, and at most 50 skipped files', () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 80; i++) files[`f-${String(i).padStart(2, '0')}.txt`] = 1;
    const fs = sizedFs(files);
    const collector = ArtifactCollector.open({ ...fs, read: () => undefined }, '/home', DIR, memoryLog().log);
    const { skipped } = (collector as ArtifactCollector).collect();
    expect(skipped).toHaveLength(ARTIFACT_LIMITS.skipped);
    expect(skipped[0]).toEqual({ path: 'f-00.txt', size: 1, reason: 'unreadable' });
  });
});

describe('a file an agent attaches (S6a)', () => {
  it('reads a text or image file inside the folder, and the end passes over it unless it changes', () => {
    const { folder, collector } = opened();
    mkdirSync(join(folder, 'shots'));
    writeFileSync(join(folder, 'shots', 'login.png'), PNG);
    writeFileSync(join(folder, 'notes.md'), '# Notes');
    const attached = collector.attach('shots/login.png');
    if ('error' in attached) throw new Error(attached.error);
    expect(attached.file).toEqual({
      path: 'shots/login.png',
      contentType: 'image/png',
      bytes: new Uint8Array(PNG),
      sha256: createHash('sha256').update(PNG).digest('hex'),
    });
    collector.sent('shots/login.png', attached.stamp);
    expect(collector.collect().files.map((f) => f.path)).toEqual(['notes.md']);
    writeFileSync(join(folder, 'shots', 'login.png'), Buffer.concat([PNG, Buffer.from([1])]));
    utimesSync(join(folder, 'shots', 'login.png'), new Date(), new Date(Date.now() + 5000));
    expect(collector.collect().files.map((f) => f.path)).toEqual(['notes.md', 'shots/login.png']);
  });

  it('refuses a path outside the folder, a link, a folder, a missing, binary or unreadable file, in words', () => {
    const { folder, cwd, collector } = opened();
    writeFileSync(join(cwd, 'secret.txt'), 'secret');
    symlinkSync(join(cwd, 'secret.txt'), join(folder, 'link.txt'));
    mkdirSync(join(folder, 'shots'));
    symlinkSync(cwd, join(folder, 'up'));
    writeFileSync(join(folder, 'build.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]));
    const error = (path: string) => {
      const attached = collector.attach(path);
      return 'error' in attached ? attached.error : 'attached';
    };
    expect(error('../../../../secret.txt')).toMatch(/is not a path inside your outputs folder/);
    expect(error('/etc/passwd')).toMatch(/is not a path inside your outputs folder/);
    expect(error('link.txt')).toBe(
      '"link.txt" is a link: attach the file itself, inside your outputs folder.',
    );
    expect(error('up/secret.txt')).toBe('"up/secret.txt" is not in your outputs folder.');
    expect(error('shots')).toBe('"shots" is not a file.');
    expect(error('missing.md')).toBe('There is no file "missing.md" in your outputs folder.');
    expect(error('build.zip')).toBe('"build.zip" is neither text nor an image.');
    const sized = ArtifactCollector.open(
      sizedFs({ 'huge.txt': ARTIFACT_LIMITS.fileBytes + 1, 'gone.txt': 3 }),
      '/home',
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    const of = (c: ArtifactCollector, path: string) => {
      const attached = c.attach(path);
      return 'error' in attached ? attached.error : 'attached';
    };
    expect(of(sized, 'huge.txt')).toBe('"huge.txt" is over the 2 MB a file may be.');
    const unreadable = ArtifactCollector.open(
      { ...sizedFs({ 'gone.txt': 3 }), read: () => undefined },
      '/home',
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    expect(of(unreadable, 'gone.txt')).toBe('"gone.txt" could not be read.');
  });
});

describe('artifactFrames', () => {
  it('gives an attached file’s parts its call’s id', () => {
    const file = {
      path: 'a.md',
      contentType: 'text/markdown; charset=utf-8',
      bytes: new Uint8Array([0x61]),
      sha256: 'e'.repeat(64),
    };
    expect(fileFrames('t', 0, file, 'call-1')).toEqual([
      {
        type: 'turn.artifact',
        turnId: 't',
        index: 0,
        path: 'a.md',
        contentType: 'text/markdown; charset=utf-8',
        size: 1,
        sha256: 'e'.repeat(64),
        part: 0,
        parts: 1,
        data: 'YQ==',
        callId: 'call-1',
      },
    ]);
    expect(fileFrames('t', 2, file)[0]).not.toHaveProperty('callId');
  });

  it('sends each file in parts of 128 KB, then what was collected and left out', () => {
    const big = new Uint8Array(ARTIFACT_LIMITS.partBytes + 3).fill(0x62);
    const frames = artifactFrames('t', {
      files: [
        {
          path: 'a.md',
          contentType: 'text/markdown; charset=utf-8',
          bytes: new Uint8Array(),
          sha256: 'e'.repeat(64),
        },
        { path: 'b.txt', contentType: 'text/plain; charset=utf-8', bytes: big, sha256: 'f'.repeat(64) },
      ],
      skipped: [{ path: 'c.zip', size: 4, reason: 'binary' }],
    });
    expect(
      frames.map((f) => (f.type === 'turn.artifact' ? [f.index, f.part, f.parts, f.size] : f.type)),
    ).toEqual([
      [0, 0, 1, 0],
      [1, 0, 2, ARTIFACT_LIMITS.partBytes + 3],
      [1, 1, 2, ARTIFACT_LIMITS.partBytes + 3],
      'turn.artifacts',
    ]);
    expect(frames[0]).toMatchObject({ data: '' });
    expect(Buffer.from((frames[2] as { data: string }).data, 'base64')).toEqual(
      Buffer.from([0x62, 0x62, 0x62]),
    );
    expect(frames[3]).toEqual({
      type: 'turn.artifacts',
      turnId: 't',
      files: 2,
      skipped: [{ path: 'c.zip', size: 4, reason: 'binary' }],
    });
  });
});
