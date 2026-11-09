import type { FsResult } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import {
  agentsRootOf,
  folderRefusal,
  listingOf,
  RUNNER_OUTDATED,
} from '../../../../src/modules/machines/rules/folders.ts';

const CMD = '019a0000-0000-7000-8000-000000000001';

describe("a runner's folder refusal", () => {
  it('is a 422 in plain words, with the API’s own code where the runner’s would clash', () => {
    const cases: readonly [string, string, string][] = [
      ['not_found: /nope', 'folder_not_found', 'There is no folder /nope on the machine'],
      ['not_a_directory: /a/f', 'not_a_directory', '/a/f is a file, not a folder'],
      ['permission_denied: /root', 'permission_denied', "The runner's user may not open /root"],
      [
        'outside_volume: /etc is outside /work',
        'outside_volume',
        'A Docker runner keeps its folders in its work volume, /work (/etc is outside /work)',
      ],
      ['exists: /a/b', 'folder_exists', '/a/b is there already'],
      [
        'invalid_path: a is not an absolute path',
        'invalid_path',
        'Give an absolute path, starting with / or ~/ (a is not an absolute path)',
      ],
      ['failed: /a: EIO', 'folder_failed', 'The machine could not read the folder: /a: EIO'],
    ];
    for (const [error, code, message] of cases) {
      expect(folderRefusal(error)).toEqual({ ok: false, status: 422, code, message });
    }
  });

  it('is runner_outdated for a runner that does not browse, and failed without words', () => {
    expect(folderRefusal('unsupported: no folders here')).toBe(RUNNER_OUTDATED);
    expect(folderRefusal(undefined)).toMatchObject({
      code: 'folder_failed',
      message: 'The machine could not read the folder: no reason given',
    });
  });
});

describe('where agents go by default, and a listing', () => {
  it('is the container’s root, else agents in the home', () => {
    expect(agentsRootOf('/home/runner', '/work')).toBe('/work');
    expect(agentsRootOf('/Users/ihor', null)).toBe('/Users/ihor/agents');
    expect(agentsRootOf('/Users/ihor/', null)).toBe('/Users/ihor/agents');
    expect(agentsRootOf('/', null)).toBe('/agents');
  });

  it('fills what a runner left out, and drops fields it does not know', () => {
    expect(listingOf({ type: 'fs.result', cmdId: CMD, ok: true }, null)).toEqual({
      path: '/',
      parent: null,
      entries: [],
      truncated: false,
      home: '/',
      root: null,
      agentsRoot: '/agents',
    });
    const entry = { name: 'a', git: true, claudeMd: false, size: 4 };
    const full: FsResult = { type: 'fs.result', cmdId: CMD, ok: true, entries: [entry], root: '/work' };
    expect(listingOf(full, '/work/x')).toMatchObject({
      path: '/work/x',
      entries: [{ name: 'a', git: true, claudeMd: false }],
      agentsRoot: '/work',
    });
    expect(listingOf({ ...full, root: null, home: '/h' }, null).path).toBe('/h');
    expect(listingOf(full, null).path).toBe('/work');
  });
});
