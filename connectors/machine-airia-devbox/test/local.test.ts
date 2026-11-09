import { describe, expect, it } from 'vitest';
import { findExecutable, localDevbox, searchDirs } from '../src/local.ts';

const HOME = '/Users/ihor';
/** A file system where only these paths exist. */
const only =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe('finding the tools without starting a process', () => {
  it("looks in the PATH's absolute folders, then Homebrew's, the classic one and gcloud's own, each once", () => {
    expect(searchDirs({ path: '/usr/bin:relative/bin::/opt/homebrew/bin', home: HOME })).toEqual([
      '/usr/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/ihor/google-cloud-sdk/bin',
    ]);
    expect(searchDirs({ path: undefined, home: HOME })).toHaveLength(3);
  });

  it('returns the first match, or nothing', () => {
    const exists = only(
      '/usr/local/bin/gcloud',
      '/Users/ihor/google-cloud-sdk/bin/gcloud',
      '/opt/tools/airia',
    );
    expect(findExecutable('gcloud', { path: '/usr/bin', home: HOME, exists })).toBe('/usr/local/bin/gcloud');
    expect(findExecutable('airia', { path: '/opt/tools', home: HOME, exists })).toBe('/opt/tools/airia');
    expect(findExecutable('airia', { path: '/usr/bin', home: HOME, exists })).toBeUndefined();
  });
});

describe('localDevbox', () => {
  it('says which of the two tools are missing, and builds the driver with both', () => {
    expect(localDevbox({ env: { PATH: '/usr/bin' }, home: HOME, exists: only() })).toEqual({
      ok: false,
      missing: ['airia', 'gcloud'],
    });
    const gcloudOnly = only('/usr/local/bin/gcloud');
    expect(localDevbox({ env: {}, home: HOME, exists: gcloudOnly })).toEqual({
      ok: false,
      missing: ['airia'],
    });
    const both = localDevbox({
      env: { PATH: '/usr/bin' },
      home: HOME,
      exists: only('/opt/homebrew/bin/airia', '/opt/homebrew/bin/gcloud'),
    });
    expect(both).toMatchObject({
      ok: true,
      airia: '/opt/homebrew/bin/airia',
      gcloud: '/opt/homebrew/bin/gcloud',
    });
    expect(both.ok && both.driver.provider).toBe('airia_devbox');
  });
});
