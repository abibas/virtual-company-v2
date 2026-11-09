import { newId } from '@mwc/shared/ids';
import { FOLDERS_MAX, type FsList, type FsMkdir } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { browse, type FoldersFs } from '../../src/folders/browse.ts';
import { fakeFoldersFs, fsError } from '../fixtures/folders.ts';

const HOME = '/Users/ihor';
const list = (path: string | null): FsList => ({ type: 'fs.list', cmdId: newId(), path });
const mkdir = (path: string): FsMkdir => ({ type: 'fs.mkdir', cmdId: newId(), path });

/** A Mac's home with agents, a checkout, hidden folders and a file. */
function mac() {
  const { fs, tree } = fakeFoldersFs(
    [
      '/',
      '/Users',
      HOME,
      `${HOME}/agents`,
      `${HOME}/agents/Scout`,
      `${HOME}/agents/slop-box`,
      `${HOME}/agents/slop-box/.git`,
      `${HOME}/agents/alpha`,
      `${HOME}/agents/agent10`,
      `${HOME}/agents/agent9`,
      `${HOME}/agents/.cache`,
      `${HOME}/agents/.claude`,
    ],
    [`${HOME}/agents/notes.md`, `${HOME}/agents/Scout/CLAUDE.md`, `${HOME}/agents/alpha/.git`],
  );
  return { host: { fs, home: HOME, root: null }, tree };
}

/** A container: its home outside the work volume, the volume with one agent, and a link out of it. */
function container() {
  const { fs, tree } = fakeFoldersFs(['/', '/home/runner', '/work', '/work/scout', '/work/escape', '/etc']);
  tree.real.set('/work/escape', '/etc');
  return { host: { fs, home: '/home/runner', root: '/work' }, tree };
}

describe('fs.list', () => {
  it('lists the folders sorted by name, numbers in order, with their git and CLAUDE.md marks, no dot-folders or files', async () => {
    const { host } = mac();
    const frame = list(`${HOME}/agents/`);
    expect(await browse(host, frame)).toEqual({
      type: 'fs.result',
      cmdId: frame.cmdId,
      ok: true,
      path: `${HOME}/agents`,
      parent: HOME,
      entries: [
        { name: 'agent9', git: false, claudeMd: false },
        { name: 'agent10', git: false, claudeMd: false },
        { name: 'alpha', git: true, claudeMd: false },
        { name: 'Scout', git: false, claudeMd: true },
        { name: 'slop-box', git: true, claudeMd: false },
      ],
      truncated: false,
      home: HOME,
      root: null,
    });
  });

  it('starts at the home by default, resolves ~, and has no parent at /', async () => {
    const { host } = mac();
    expect(await browse(host, list(null))).toMatchObject({ ok: true, path: HOME, parent: '/Users' });
    expect(await browse(host, list('~/agents'))).toMatchObject({ path: `${HOME}/agents` });
    expect(await browse(host, list('/'))).toMatchObject({
      path: '/',
      parent: null,
      entries: [{ name: 'Users' }],
    });
  });

  it(`keeps the first ${FOLDERS_MAX} folders and says the list was cut`, async () => {
    const names = Array.from({ length: FOLDERS_MAX + 3 }, (_, i) => `/big/f${String(i).padStart(3, '0')}`);
    const { fs } = fakeFoldersFs(['/', '/big', ...names]);
    const result = await browse({ fs, home: HOME, root: null }, list('/big'));
    expect(result.entries).toHaveLength(FOLDERS_MAX);
    expect(result.entries?.at(-1)?.name).toBe(`f${FOLDERS_MAX - 1}`);
    expect(result.truncated).toBe(true);
  });

  it('refuses a missing folder, a file, a folder it may not read, a relative path and another failure', async () => {
    const { host, tree } = mac();
    tree.denied.add('/Users/ihor/agents/Scout');
    tree.broken.add('/Users/ihor/agents/alpha');
    const refusals = await Promise.all(
      ['/nope', `${HOME}/agents/notes.md`, `${HOME}/agents/Scout`, 'agents', `${HOME}/agents/alpha`].map(
        async (path) => (await browse(host, list(path))).error,
      ),
    );
    expect(refusals).toEqual([
      'not_found: /nope',
      `not_a_directory: ${HOME}/agents/notes.md`,
      `permission_denied: ${HOME}/agents/Scout`,
      'invalid_path: agents is not an absolute path',
      `failed: ${HOME}/agents/alpha: EIO: ${HOME}/agents/alpha`,
    ]);
  });

  it('in a container starts at /work, stops there, and refuses a path or a link out of it', async () => {
    const { host } = container();
    expect(await browse(host, list(null))).toMatchObject({
      ok: true,
      path: '/work',
      parent: null,
      entries: [
        { name: 'escape', git: false, claudeMd: false },
        { name: 'scout', git: false, claudeMd: false },
      ],
      home: '/home/runner',
      root: '/work',
    });
    expect((await browse(host, list('/work/scout'))).parent).toBe('/work');
    expect((await browse(host, list('/etc'))).error).toBe('outside_volume: /etc is outside /work');
    expect((await browse(host, list('~'))).error).toBe('outside_volume: /home/runner is outside /work');
    expect((await browse(host, list('/work/escape'))).error).toBe(
      'outside_volume: /work/escape leads outside /work',
    );
  });

  it('keeps names that differ only in case in a steady order', async () => {
    const { fs } = fakeFoldersFs(['/', '/c', '/c/b', '/c/same', '/c/Same', '/c/SAME', '/c/a']);
    const result = await browse({ fs, home: HOME, root: null }, list('/c'));
    expect(result.entries?.map((entry) => entry.name)).toEqual(['a', 'b', 'SAME', 'Same', 'same']);
  });

  it('reads ENOTDIR as not a folder, an error with no code as failed, and a mark that cannot be read as failed', async () => {
    const { host } = mac();
    const notDir: FoldersFs = { ...host.fs, isDirectory: () => Promise.reject(fsError('ENOTDIR', 'x')) };
    expect((await browse({ ...host, fs: notDir }, list('/a/b'))).error).toBe('not_a_directory: /a/b');
    const nothing: FoldersFs = { ...host.fs, readdir: () => Promise.reject(null) };
    expect((await browse({ ...host, fs: nothing }, list(HOME))).error).toBe(`failed: ${HOME}: it failed`);
    const marks: FoldersFs = { ...host.fs, exists: () => Promise.reject(new Error('EIO')) };
    expect((await browse({ ...host, fs: marks }, list(`${HOME}/agents`))).error).toBe('failed: EIO');
  });

  it('answers failed when the file system throws something that is not an error', async () => {
    const { host } = mac();
    const fs: FoldersFs = {
      ...host.fs,
      readdir: () => Promise.reject('no'),
      realpath: host.fs.realpath,
    };
    expect((await browse({ ...host, fs }, list(HOME))).error).toBe(`failed: ${HOME}: it failed`);
    const throwing: FoldersFs = {
      ...host.fs,
      isDirectory: () => {
        throw 'sync';
      },
    };
    expect((await browse({ ...host, fs: throwing }, list(HOME))).error).toBe(`failed: ${HOME}: it failed`);
  });
});

describe('fs.mkdir', () => {
  it('makes one folder in a folder that exists, and answers its path', async () => {
    const { host, tree } = mac();
    const frame = mkdir('~/agents/new-one');
    expect(await browse(host, frame)).toEqual({
      type: 'fs.result',
      cmdId: frame.cmdId,
      ok: true,
      path: `${HOME}/agents/new-one`,
    });
    expect(tree.made).toEqual([`${HOME}/agents/new-one`]);
  });

  it('refuses a folder already there, a missing parent, a parent that is a file, / itself, and no permission', async () => {
    const { host, tree } = mac();
    tree.denied.add(`${HOME}/agents/locked`);
    const refusals = await Promise.all(
      [
        `${HOME}/agents/Scout`,
        `${HOME}/agents/notes.md`,
        `${HOME}/missing/new`,
        `${HOME}/agents/notes.md/new`,
        '/',
        `${HOME}/agents/locked`,
      ].map(async (path) => (await browse(host, mkdir(path))).error),
    );
    expect(refusals).toEqual([
      `exists: ${HOME}/agents/Scout`,
      `exists: ${HOME}/agents/notes.md`,
      `not_found: ${HOME}/missing`,
      `not_a_directory: ${HOME}/agents/notes.md`,
      'exists: /',
      `permission_denied: ${HOME}/agents/locked`,
    ]);
    expect(tree.made).toEqual([]);
  });

  it('in a container makes folders only under /work, never /work itself or through a link out', async () => {
    const { host, tree } = container();
    expect(await browse(host, mkdir('/work/new'))).toMatchObject({ ok: true, path: '/work/new' });
    expect((await browse(host, mkdir('/work'))).error).toBe('exists: /work');
    expect((await browse(host, mkdir('/etc/x'))).error).toBe('outside_volume: /etc/x is outside /work');
    expect((await browse(host, mkdir('/work/escape/x'))).error).toBe(
      'outside_volume: /work/escape leads outside /work',
    );
    expect(tree.made).toEqual(['/work/new']);
  });

  it('refuses a mkdir when the file system fails with no code', async () => {
    const { host } = mac();
    const fs: FoldersFs = { ...host.fs, mkdir: () => Promise.reject(fsError('EROFS', 'ro')) };
    expect((await browse({ ...host, fs }, mkdir(`${HOME}/x`))).error).toBe(`failed: ${HOME}/x: EROFS: ro`);
  });
});
