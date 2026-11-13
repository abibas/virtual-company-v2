import { describe, expect, it } from 'vitest';
import {
  FOLDER_ERRORS,
  FOLDERS_MAX,
  FolderName,
  FsList,
  FsMkdir,
  FsMkdirp,
  FsResult,
  folderErrorCode,
} from '../../src/runner-protocol/folders.ts';
import { RunnerHello } from '../../src/runner-protocol/runner-frames.ts';
import { IDS, RUNNER_EXAMPLES, SERVER_EXAMPLES } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

describe('runner.hello caps.folders', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];

  it('reads an old runner without it as one that does not browse folders', () => {
    const parsed = RunnerHello.parse({ ...hello, caps: without(hello.caps, 'folders') });
    expect(parsed.caps.folders).toBe(false);
    expect(RunnerHello.parse(hello).caps.folders).toBe(true);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...hello.caps, folders: 1 } })).toEqual([
      'caps.folders',
    ]);
  });
});

describe('runner.hello caps.mkdirp', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];

  it('reads an old runner without it as one that does not make parents', () => {
    expect(RunnerHello.parse({ ...hello, caps: without(hello.caps, 'mkdirp') }).caps.mkdirp).toBe(false);
    expect(RunnerHello.parse(hello).caps.mkdirp).toBe(true);
  });
});

describe('fs.list and fs.mkdir', () => {
  it('take an absolute path or one under ~, and fs.list null for the default start', () => {
    expect(issuesOf(FsList, SERVER_EXAMPLES['fs.list'])).toEqual([]);
    expect(issuesOf(FsList, { type: 'fs.list', cmdId: IDS.cmd, path: null })).toEqual([]);
    expect(issuesOf(FsList, { type: 'fs.list', cmdId: IDS.cmd, path: 'agents' })).toEqual(['path']);
    expect(issuesOf(FsMkdir, SERVER_EXAMPLES['fs.mkdir'])).toEqual([]);
    expect(issuesOf(FsMkdir, { type: 'fs.mkdir', cmdId: IDS.cmd, path: null })).toEqual(['path']);
    expect(issuesOf(FsMkdir, { type: 'fs.mkdir', cmdId: 'x', path: '/a' })).toEqual(['cmdId']);
    expect(issuesOf(FsMkdirp, SERVER_EXAMPLES['fs.mkdirp'])).toEqual([]);
    expect(issuesOf(FsMkdirp, { type: 'fs.mkdirp', cmdId: IDS.cmd, path: 'work' })).toEqual(['path']);
  });
});

describe('fs.result', () => {
  const result = RUNNER_EXAMPLES['fs.result'];

  it('answers a listing, a made folder, or a refusal', () => {
    expect(issuesOf(FsResult, result)).toEqual([]);
    expect(issuesOf(FsResult, { type: 'fs.result', cmdId: IDS.cmd, ok: true, path: '/w/a' })).toEqual([]);
    const made = { type: 'fs.result', cmdId: IDS.cmd, ok: true, path: '/w/a', created: false };
    expect(issuesOf(FsResult, made)).toEqual([]);
    expect(issuesOf(FsResult, { ...made, created: 'no' })).toEqual(['created']);
    const refused = { type: 'fs.result', cmdId: IDS.cmd, ok: false, error: 'not_found: /nope' };
    expect(issuesOf(FsResult, refused)).toEqual([]);
  });

  it('refuses a relative path, more than the most folders, and a name with a slash', () => {
    expect(issuesOf(FsResult, { ...result, path: 'agents' })).toEqual(['path']);
    const many = Array.from({ length: FOLDERS_MAX + 1 }, (_, i) => ({
      name: `f${i}`,
      git: false,
      claudeMd: false,
    }));
    expect(issuesOf(FsResult, { ...result, entries: many })).toEqual(['entries']);
    expect(issuesOf(FolderName, 'a/b')).toEqual(['']);
    expect(issuesOf(FolderName, 'a b')).toEqual([]);
  });

  it('reads the code of an error, and failed for an unknown one', () => {
    for (const code of FOLDER_ERRORS) expect(folderErrorCode(`${code}: words`)).toBe(code);
    expect(folderErrorCode('exists')).toBe('exists');
    expect(folderErrorCode('EIO: oops')).toBe('failed');
    expect(folderErrorCode(undefined)).toBe('failed');
  });
});
