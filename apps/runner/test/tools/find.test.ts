import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findTools, harnessesOf, toolCli } from '../../src/tools/find.ts';
import { toolsHost } from '../../src/tools/host.ts';
import { executable, testHost } from '../fixtures/host.ts';

const NONE = { claude: null, codex: null, git: null, gh: null, docker: null };

describe("the machine's CLIs", () => {
  it('asks each one found its version once, side by side, and starts nothing for a missing or silent one', async () => {
    const none = testHost();
    expect(await findTools(none.host)).toEqual({ versions: NONE, clis: {} });
    expect(none.execs).toEqual([]);
    const printed: Record<string, string> = {
      claude: '2.1.319 (Claude Code)\n',
      codex: 'codex-cli 0.163.0\n',
      git: 'git version 2.39.5 (Apple Git-154)\n',
      gh: 'gh version 2.40.0 (2023-12-07)\nhttps://github.com/cli/cli/releases/tag/v2.40.0\n',
    };
    const { host, home, execs } = testHost({
      exec: (file) => {
        const name = file.split('/').at(-1) as string;
        return name in printed
          ? { code: 0, stdout: printed[name] as string, stderr: '' }
          : { code: 1, stdout: '', stderr: '' };
      },
    });
    const bin = join(home, 'bin');
    const paths = ['claude', 'codex', 'git', 'gh', 'docker'].map((name) => executable(bin, name));
    const found = await findTools(host);
    expect(found.versions).toEqual({
      claude: '2.1.319 (Claude Code)',
      codex: 'codex-cli 0.163.0',
      git: 'git version 2.39.5 (Apple Git-154)',
      gh: 'gh version 2.40.0 (2023-12-07)',
      docker: null,
    });
    expect(Object.keys(found.clis)).toEqual(['claude', 'codex', 'git', 'gh']);
    expect(execs.map((call) => [call.file, call.args])).toEqual(paths.map((path) => [path, ['--version']]));
    expect(execs[0]?.env?.PATH?.split(':')[0]).toBe(bin);
    expect(harnessesOf(found)).toEqual({
      claude_code: { path: paths[0], version: '2.1.319 (Claude Code)' },
      codex: { path: paths[1], version: 'codex-cli 0.163.0' },
    });
    expect(harnessesOf({ versions: NONE, clis: {} })).toEqual({});
  });

  it('keeps the first line of a version, cut to 100 characters', async () => {
    const { host, home } = testHost({
      exec: () => ({ code: 0, stdout: `  ${'x'.repeat(150)}\nmore`, stderr: '' }),
    });
    const path = executable(join(home, 'bin'), 'docker');
    expect(await toolCli(host, 'docker')).toEqual({ path, version: 'x'.repeat(100) });
    const empty = testHost({ exec: () => ({ code: 0, stdout: '\n', stderr: '' }) });
    executable(join(empty.home, 'bin'), 'git');
    expect(await toolCli(empty.host, 'git')).toBeUndefined();
  });
});

describe("the tools' host", () => {
  it('finds the npm beside the runner’s Node, and installs under the home', async () => {
    const { host, home } = testHost();
    const node = executable(join(home, 'node', 'bin'), 'node');
    const tools = toolsHost({ ...host, execPath: node });
    expect(tools.npm()).toBeUndefined();
    const npm = executable(join(home, 'node', 'bin'), 'npm');
    expect(tools.npm()).toBe(npm);
    expect(tools.home).toBe(home);
    expect(tools.env).toBe(host.env);
    expect((await tools.find()).versions).toEqual(NONE);
  });
});
