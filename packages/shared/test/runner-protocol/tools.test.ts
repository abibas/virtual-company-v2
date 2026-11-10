import { describe, expect, it } from 'vitest';
import { RunnerCapsUpdate, RunnerHello } from '../../src/runner-protocol/runner-frames.ts';
import {
  RunnerTools,
  TOOL_INSTALL_ERRORS,
  ToolsCheck,
  ToolsInstall,
  ToolsOutput,
  ToolsResult,
  toolInstallErrorCode,
} from '../../src/runner-protocol/tools.ts';
import { IDS, RUNNER_EXAMPLES, SERVER_EXAMPLES, TOOLS } from '../fixtures/runner-protocol/frames.ts';
import { issuesOf, without } from '../fixtures/runner-protocol/issues.ts';

describe('runner.hello caps.tools', () => {
  const hello = RUNNER_EXAMPLES['runner.hello'];

  it('is left out by a runner older than the tools, and read as each CLI version or null', () => {
    expect(RunnerHello.parse({ ...hello, caps: without(hello.caps, 'tools') }).caps.tools).toBeUndefined();
    expect(RunnerHello.parse(hello).caps.tools).toEqual(TOOLS);
    expect(issuesOf(RunnerHello, { ...hello, caps: { ...hello.caps, tools: { git: '' } } })).toEqual([
      'caps.tools.git',
    ]);
  });

  it('takes a CLI it does not know yet as null, and passes a newer one through', () => {
    expect(RunnerTools.parse({ claude: '2.1.319 (Claude Code)', bun: '1.3.0' })).toEqual({
      claude: '2.1.319 (Claude Code)',
      codex: null,
      git: null,
      gh: null,
      docker: null,
      bun: '1.3.0',
    });
  });
});

describe('runner.caps', () => {
  it('carries the whole caps again', () => {
    const update = RUNNER_EXAMPLES['runner.caps'];
    expect(issuesOf(RunnerCapsUpdate, update)).toEqual([]);
    expect(issuesOf(RunnerCapsUpdate, { type: 'runner.caps', caps: { slots: 2 } })).toEqual([
      'caps.harnesses',
      'caps.hold',
      'caps.power',
    ]);
  });
});

describe('tools.check and tools.install', () => {
  it('check takes a command id; install Claude Code or Codex at an exact version', () => {
    expect(issuesOf(ToolsCheck, SERVER_EXAMPLES['tools.check'])).toEqual([]);
    const install = SERVER_EXAMPLES['tools.install'];
    expect(issuesOf(ToolsInstall, install)).toEqual([]);
    expect(issuesOf(ToolsInstall, { ...install, tool: 'claude', version: '2.1.308' })).toEqual([]);
    expect(issuesOf(ToolsInstall, { ...install, version: '1.0.0-beta.1' })).toEqual([]);
    expect(issuesOf(ToolsInstall, { ...install, tool: 'git' })).toEqual(['tool']);
    for (const version of ['latest', '^0.163.0', '0.163', '0.163.0 && rm -rf ~']) {
      expect(issuesOf(ToolsInstall, { ...install, version })).toEqual(['version']);
    }
  });
});

describe('tools.output and tools.result', () => {
  it('a line is at most 500 characters; a result says ok, the tools and why not', () => {
    expect(issuesOf(ToolsOutput, RUNNER_EXAMPLES['tools.output'])).toEqual([]);
    expect(issuesOf(ToolsOutput, { type: 'tools.output', cmdId: IDS.cmd, line: 'x'.repeat(501) })).toEqual([
      'line',
    ]);
    expect(issuesOf(ToolsResult, RUNNER_EXAMPLES['tools.result'])).toEqual([]);
    const refused = {
      type: 'tools.result',
      cmdId: IDS.cmd,
      ok: false,
      error: 'busy: codex is being installed',
    };
    expect(issuesOf(ToolsResult, refused)).toEqual([]);
    expect(issuesOf(ToolsResult, { type: 'tools.result', cmdId: IDS.cmd })).toEqual(['ok']);
  });

  it('reads the code of an error, failed for any other text', () => {
    for (const code of TOOL_INSTALL_ERRORS) expect(toolInstallErrorCode(`${code}: words`)).toBe(code);
    expect(toolInstallErrorCode('npm_missing')).toBe('npm_missing');
    expect(toolInstallErrorCode('something else')).toBe('failed');
    expect(toolInstallErrorCode(undefined)).toBe('failed');
  });
});
