import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BANNED_TERMS,
  cachedScanDeps,
  commitMessageText,
  isBinary,
  type ScanDeps,
  SKIPPED_FILES,
  scanFiles,
  scanText,
  systemScanDeps,
} from '../src/banned.ts';
import { bannedNames } from '../src/check.ts';
import type { MainIo } from '../src/io.ts';
import { main } from '../src/main.ts';

// Built from parts, like the list itself, so this file never holds a banned name.
const WORD = 'paper' + 'clip';

function capture(cwd = '/repo') {
  const out: string[] = [];
  const err: string[] = [];
  const io: MainIo = { stdout: (s) => out.push(s), stderr: (s) => err.push(s), cwd, env: {} };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

function files(map: Record<string, string | Uint8Array>): ScanDeps {
  return {
    listFiles: () => Object.keys(map),
    readFile: (path) => {
      const content = map[path];
      return typeof content === 'string' ? Buffer.from(content) : content;
    },
  };
}

describe('scanText', () => {
  it('reports each line holding a term, 1-based, case-insensitively and inside longer words', () => {
    const text = [
      'fine',
      `the ${WORD.toUpperCase()} lab`,
      `x-${WORD[0]?.toUpperCase()}${WORD.slice(1)}-y`,
      '',
    ].join('\n');
    expect(scanText('docs/a.md', text)).toEqual([
      { file: 'docs/a.md', line: 2, term: WORD },
      { file: 'docs/a.md', line: 3, term: WORD },
    ]);
  });

  it('finds nothing in clean text, and takes another term list', () => {
    expect(scanText('a', 'paper and clip, apart')).toEqual([]);
    expect(scanText('a', 'Old Name here', ['old' + ' name'])).toEqual([
      { file: 'a', line: 1, term: 'old name' },
    ]);
    expect(BANNED_TERMS).toContain(WORD);
  });
});

describe('scanFiles', () => {
  it('skips the lockfile, binary files and files gone from the working tree', () => {
    const deps: ScanDeps = {
      listFiles: () => ['pnpm-lock.yaml', 'logo.png', 'gone.md', 'docs/x.md'],
      readFile: (path) =>
        ({
          'pnpm-lock.yaml': Buffer.from(`${WORD}: 1.0.0`),
          'logo.png': Uint8Array.from([0x89, 0x50, 0x00, ...Buffer.from(WORD)]),
          'docs/x.md': Buffer.from(`ok\n${WORD}`),
        })[path],
    };
    expect(SKIPPED_FILES.has('pnpm-lock.yaml')).toBe(true);
    expect(scanFiles(deps)).toEqual([{ file: 'docs/x.md', line: 2, term: WORD }]);
  });

  it('calls content with a NUL byte in its first 8000 bytes binary, like git', () => {
    expect(isBinary(Buffer.from('plain text'))).toBe(false);
    expect(isBinary(Uint8Array.from([65, 0, 66]))).toBe(true);
    expect(isBinary(Buffer.concat([Buffer.alloc(8000, 65), Buffer.from([0])]))).toBe(false);
  });
});

describe('systemScanDeps (one real git process)', () => {
  it("lists this repository's files through git and reads them; a missing file reads as undefined", () => {
    const deps = systemScanDeps(resolve(import.meta.dirname, '../../..'));
    const listed = deps.listFiles();
    expect(listed).toEqual(expect.arrayContaining(['package.json', 'packages/cli/src/banned.ts']));
    expect(listed.some((file) => file.includes('node_modules/'))).toBe(false);
    expect(Buffer.from(deps.readFile('package.json') ?? []).toString()).toContain('"name"');
    expect(deps.readFile('no/such/file')).toBeUndefined();
    expect(() => systemScanDeps('/').listFiles()).toThrow(/git ls-files failed/);
  });
});

describe('bannedNames (the check step)', () => {
  it('passes on clean files and says how many it read', () => {
    const c = capture();
    expect(bannedNames(c.io, files({ 'a.ts': 'const a = 1;', 'b.md': '# b' }))).toBe(true);
    expect(c.out()).toBe('no banned names in 2 files\n');
  });

  it('fails with file:line hits', () => {
    const c = capture();
    expect(bannedNames(c.io, files({ 'docs/p.md': `one\ntwo ${WORD}` }))).toBe(false);
    expect(c.err()).toContain(`docs/p.md:2: banned name "${WORD}"\n`);
  });
});

describe('commitMessageText', () => {
  it("drops git's comment lines and everything after the scissors line", () => {
    const raw = [
      'S9 Title',
      '',
      'Body line.',
      `# Please enter the commit message (${WORD} in a comment is fine)`,
      '# ------------------------ >8 ------------------------',
      `-the removed ${WORD} line in the diff`,
    ].join('\n');
    expect(commitMessageText(raw)).toBe('S9 Title\n\nBody line.\n');
  });
});

describe('mwc banned', () => {
  it('scans the repository files through its dependency', () => {
    const clean = capture();
    expect(main(['banned'], clean.io, { scan: files({ 'a.md': 'clean' }) })).toBe(0);
    const dirty = capture();
    expect(main(['banned'], dirty.io, { scan: files({ 'a.md': WORD }) })).toBe(1);
    expect(dirty.err()).toContain('a.md:1:');
  });

  it('checks a commit message file with --message (the commit-msg hook), relative to the cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mwc-commit-msg-'));
    try {
      writeFileSync(join(dir, 'good'), 'S1 Clean title\n\n# a comment\n');
      writeFileSync(join(dir, 'bad'), `S1 Title\n\nMoved from ${WORD.toUpperCase()}.\n`);
      const good = capture(dir);
      expect(main(['banned', '--message', 'good'], good.io)).toBe(0);
      const bad = capture(dir);
      expect(main(['banned', '--message', join(dir, 'bad')], bad.io)).toBe(1);
      expect(bad.err()).toContain('commit message:3: banned name');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses --message without a file, or a file it cannot read', () => {
    const c = capture();
    expect(main(['banned', '--message'], c.io)).toBe(2);
    expect(c.err()).toBe('mwc banned: --message needs a file\n');
    const missing = capture('/nonexistent');
    expect(main(['banned', '--message', 'COMMIT_EDITMSG'], missing.io)).toBe(2);
    expect(missing.err()).toContain('cannot read COMMIT_EDITMSG');
  });

  it('is what the executable commit-msg hook runs on the message file', () => {
    const hook = resolve(import.meta.dirname, '../../../.githooks/commit-msg');
    expect(readFileSync(hook, 'utf8')).toContain('node packages/cli/src/mwc.ts banned --message "$1"');
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });
});

describe('cachedScanDeps', () => {
  it('lists once and reads each file once, however often it is asked, and hands out copies of the list', () => {
    let listings = 0;
    const reads: string[] = [];
    const cached = cachedScanDeps({
      listFiles: () => {
        listings++;
        return ['a.ts', 'gone.ts'];
      },
      readFile: (path) => {
        reads.push(path);
        return path === 'a.ts' ? Buffer.from('a') : undefined;
      },
    });
    const first = cached.listFiles();
    first.push('mutated.ts');
    expect(cached.listFiles()).toEqual(['a.ts', 'gone.ts']);
    expect(listings).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(Buffer.from(cached.readFile('a.ts') ?? '').toString()).toBe('a');
      expect(cached.readFile('gone.ts')).toBeUndefined();
    }
    expect(reads).toEqual(['a.ts', 'gone.ts']);
  });
});
