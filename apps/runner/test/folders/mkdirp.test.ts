import { newId } from '@mwc/shared/ids';
import type { FsMkdirp } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { browse, type FoldersFs } from '../../src/folders/browse.ts';
import { homeMaker, makeRootOf } from '../../src/folders/mkdirp.ts';
import { fakeFoldersFs, fsError } from '../fixtures/folders.ts';
import { memoryLog } from '../fixtures/log.ts';

const HOME = '/Users/ihor';
const mkdirp = (path: string): FsMkdirp => ({ type: 'fs.mkdirp', cmdId: newId(), path });

/** A Mac's home with an agents folder, a file, and a link out of the home. */
function mac() {
  const { fs, tree } = fakeFoldersFs(['/', '/Users', HOME, `${HOME}/agents`, '/opt'], [`${HOME}/notes.md`]);
  tree.real.set(`${HOME}/out`, '/opt');
  tree.dirs.add(`${HOME}/out`);
  return { host: { fs, home: HOME, root: null }, tree };
}

/** A container: its home outside the work volume, the volume, and a link out of it. */
function container() {
  const { fs, tree } = fakeFoldersFs(['/', '/home/runner', '/work', '/work/escape', '/etc']);
  tree.real.set('/work/escape', '/etc');
  return { host: { fs, home: '/home/runner', root: '/work' }, tree };
}

describe('fs.mkdirp', () => {
  it('makes a folder with its missing parents and says it made it', async () => {
    const { host, tree } = mac();
    const frame = mkdirp('~/agents/team/test-dev');
    expect(await browse(host, frame)).toEqual({
      type: 'fs.result',
      cmdId: frame.cmdId,
      ok: true,
      path: `${HOME}/agents/team/test-dev`,
      created: true,
    });
    expect(tree.made).toEqual([`${HOME}/agents/team`, `${HOME}/agents/team/test-dev`]);
  });

  it('answers a folder already there without making anything, the root itself too', async () => {
    const { host, tree } = mac();
    expect(await browse(host, mkdirp(`${HOME}/agents`))).toMatchObject({ ok: true, created: false });
    expect(await browse(host, mkdirp('~'))).toMatchObject({ ok: true, path: HOME, created: false });
    expect(tree.made).toEqual([]);
  });

  it('on a machine makes folders only in the runner user’s home, never above it or through a link out', async () => {
    const { host, tree } = mac();
    const refusals = await Promise.all(
      ['/opt/agents/x', '/Users', `${HOME}/../other/x`, `${HOME}/out/x`, 'agents/x', `${HOME}/../../..`].map(
        async (path) => (await browse(host, mkdirp(path))).error,
      ),
    );
    expect(refusals).toEqual([
      `outside_roots: /opt/agents/x is outside ${HOME}`,
      `outside_roots: /Users is outside ${HOME}`,
      `outside_roots: /Users/other/x is outside ${HOME}`,
      `outside_roots: ${HOME}/out leads outside ${HOME}`,
      'invalid_path: agents/x is not an absolute path',
      `invalid_path: ${HOME}/../../.. climbs above /`,
    ]);
    expect(tree.made).toEqual([]);
  });

  it('in a container makes folders only under /work, never through a link out of it', async () => {
    const { host, tree } = container();
    expect(await browse(host, mkdirp('/work/test-dev'))).toMatchObject({ ok: true, created: true });
    expect((await browse(host, mkdirp('/home/runner/x'))).error).toBe(
      'outside_volume: /home/runner/x is outside /work',
    );
    expect((await browse(host, mkdirp('/work/escape/a/b'))).error).toBe(
      'outside_volume: /work/escape leads outside /work',
    );
    expect(tree.made).toEqual(['/work/test-dev']);
  });

  it('refuses a file on the way or at the path, a missing root, no permission and a failing file system', async () => {
    const { host, tree } = mac();
    tree.denied.add(`${HOME}/agents/locked`);
    expect((await browse(host, mkdirp(`${HOME}/notes.md/x`))).error).toBe(
      `not_a_directory: ${HOME}/notes.md/x`,
    );
    expect((await browse(host, mkdirp(`${HOME}/notes.md`))).error).toBe(`not_a_directory: ${HOME}/notes.md`);
    expect((await browse(host, mkdirp(`${HOME}/agents/locked`))).error).toBe(
      `permission_denied: ${HOME}/agents/locked`,
    );
    const gone = fakeFoldersFs(['/']);
    expect((await browse({ fs: gone.fs, home: HOME, root: null }, mkdirp('~/a'))).error).toBe(
      `not_found: ${HOME}`,
    );
    const fs: FoldersFs = { ...host.fs, mkdirp: () => Promise.reject(fsError('EROFS', 'ro')) };
    expect((await browse({ ...host, fs }, mkdirp(`${HOME}/x`))).error).toBe(`failed: ${HOME}/x: EROFS: ro`);
    expect(tree.made).toEqual([]);
  });

  it('makes the missing folders under the real path of the nearest folder there', async () => {
    const { fs, tree } = fakeFoldersFs(['/', '/home/runner', '/data', '/data/work']);
    tree.real.set('/work', '/data/work');
    tree.dirs.add('/work');
    const made = await browse({ fs, home: '/home/runner', root: '/work' }, mkdirp('/work/a/b'));
    expect(made).toMatchObject({ ok: true, path: '/work/a/b', created: true });
    expect(tree.made).toEqual(['/data/work/a', '/data/work/a/b']);
  });

  it('makes folders in the container’s root, else in the home', () => {
    expect(makeRootOf({ home: HOME, root: null })).toBe(HOME);
    expect(makeRootOf({ home: HOME, root: '/work' })).toBe('/work');
  });
});

describe('homeMaker', () => {
  it('makes a turn’s missing home folder, and says true when it is there', async () => {
    const { host, tree } = container();
    const { log, messages } = memoryLog();
    const make = homeMaker(host, log);
    expect(await make('/work/test-dev')).toBe(true);
    expect(await make('/work/test-dev')).toBe(true);
    expect(tree.made).toEqual(['/work/test-dev']);
    expect(messages('info')).toEqual(["made the agent's home folder"]);
  });

  it('says false and logs why for a folder it may not make', async () => {
    const { host, tree } = container();
    const { log, entries } = memoryLog();
    expect(await homeMaker(host, log)('/home/runner/agent')).toBe(false);
    expect(
      await homeMaker({ ...host, fs: { ...host.fs, mkdirp: () => Promise.reject('no') } }, log)('/work/a'),
    ).toBe(false);
    expect(tree.made).toEqual([]);
    expect(entries.map((entry) => entry.error)).toEqual([
      'outside_volume: /home/runner/agent is outside /work',
      'failed: /work/a: it failed',
    ]);
  });
});
