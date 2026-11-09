import { describe, expect, it } from 'vitest';
import {
  CLI_DIRS,
  type CliFs,
  cliSearchDirs,
  findCli,
  newestNvmBin,
  pathWithCliDir,
  usualCliDirs,
} from '../../src/system/find-cli.ts';

const HOME = '/home/ihor';
const NVM = `${HOME}/.nvm/versions/node`;

/** A file system with these executables and these folders' entries; nothing else. */
function fakeFs(executables: readonly string[], dirs: Readonly<Record<string, readonly string[]>> = {}) {
  const asked: string[] = [];
  const fs: CliFs = {
    isExecutable: (path) => {
      asked.push(path);
      return executables.includes(path);
    },
    listDir: (path) => dirs[path] ?? [],
  };
  return { fs, asked };
}

describe('where the runner finds a CLI', () => {
  it("looks on the PATH's absolute folders first, then the usual install folders, each once", () => {
    const { fs } = fakeFs([]);
    expect(cliSearchDirs({ path: '/usr/bin:relative/bin::/opt/tools', home: HOME, fs })).toEqual([
      '/usr/bin',
      '/opt/tools',
      `${HOME}/.local/bin`,
      `${HOME}/.claude/local`,
      `${HOME}/.npm-global/bin`,
      `${HOME}/.bun/bin`,
      `${HOME}/.volta/bin`,
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ]);
    expect(cliSearchDirs({ path: undefined, home: HOME, fs })).toHaveLength(CLI_DIRS.length);
  });

  it('finds a CLI on the PATH before the usual folders', () => {
    const { fs } = fakeFs(['/opt/tools/claude', `${HOME}/.local/bin/claude`]);
    expect(findCli('claude', { path: '/opt/tools', home: HOME, fs })).toBe('/opt/tools/claude');
  });

  it("finds Claude Code's native install in ~/.local/bin when the PATH is a service's short one", () => {
    const { fs } = fakeFs([`${HOME}/.local/bin/claude`, '/opt/homebrew/bin/codex']);
    const deps = { path: '/usr/bin:/bin', home: HOME, fs };
    expect(findCli('claude', deps)).toBe(`${HOME}/.local/bin/claude`);
    expect(findCli('codex', deps)).toBe('/opt/homebrew/bin/codex');
  });

  it("finds a CLI in the newest nvm Node's bin, by version and not by name", () => {
    const dirs = { [NVM]: ['v9.11.2', 'v24.21.0', 'v24.3.1', 'v22.99.0', 'system', '.DS_Store', 'v24.21'] };
    expect(newestNvmBin(HOME, fakeFs([], dirs).fs)).toBe(`${NVM}/v24.21.0/bin`);
    const { fs } = fakeFs([`${NVM}/v24.21.0/bin/codex`, `${NVM}/v9.11.2/bin/codex`], dirs);
    expect(findCli('codex', { path: '', home: HOME, fs })).toBe(`${NVM}/v24.21.0/bin/codex`);
    expect(usualCliDirs(HOME, fs).at(-1)).toBe(`${NVM}/v24.21.0/bin`);
    expect(newestNvmBin(HOME, fakeFs([], { [NVM]: ['v1.2.3', 'v1.2.3'] }).fs)).toBe(`${NVM}/v1.2.3/bin`);
  });

  it('finds nothing when no folder has it, and only asks the file system (no process)', () => {
    const { fs, asked } = fakeFs([]);
    expect(newestNvmBin(HOME, fs)).toBeUndefined();
    expect(findCli('claude', { path: '/usr/bin', home: HOME, fs })).toBeUndefined();
    expect(asked).toEqual(cliSearchDirs({ path: '/usr/bin', home: HOME, fs }).map((dir) => `${dir}/claude`));
  });

  it("puts a CLI's folder first on a PATH, once", () => {
    expect(pathWithCliDir('/a/bin/claude', '/usr/bin:/a/bin::/bin')).toBe('/a/bin:/usr/bin:/bin');
    expect(pathWithCliDir('/a/bin/claude', undefined)).toBe('/a/bin');
  });
});
