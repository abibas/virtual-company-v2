import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { changedFiles } from '../../src/check/changed.ts';

/**
 * `changedFiles` outside a repository with an `origin/main` (a fresh clone's worktree has one; check.test.ts runs it on
 * this repository): it falls back to `HEAD~1`, and where git finds nothing at all, nothing changed.
 */

const outside = mkdtempSync(join(tmpdir(), 'mwc-changed-'));
afterAll(() => rmSync(outside, { recursive: true, force: true }));

describe('changedFiles', () => {
  it('finds nothing where git has no repository, after trying HEAD~1 for want of origin/main', () => {
    expect(changedFiles(outside)).toEqual([]);
  });
});
