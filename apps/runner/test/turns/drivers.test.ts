import { join } from 'node:path';
import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CodexDriver } from '@mwc/harness-codex';
import { describe, expect, it } from 'vitest';
import {
  HARNESS_COMMANDS,
  harnessDrivers,
  harnessHost,
  harnessVersions,
  turnsRoot,
} from '../../src/turns/drivers.ts';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { TOOL_SERVER } from '../fixtures/ask.ts';
import { memoryLog } from '../fixtures/log.ts';
import { tempDir } from '../fixtures/runner.ts';

describe("the runner's harnesses", () => {
  it('drive each CLI found by its full path and say its version; none for a missing one', () => {
    const clis = {
      claude_code: { path: '/opt/bin/claude', version: '2.1.319 (Claude Code)' },
      codex: { path: '/opt/bin/codex', version: 'codex-cli 0.163.0' },
    };
    const drivers = harnessDrivers(clis);
    expect(drivers.claude_code).toBeInstanceOf(ClaudeCodeDriver);
    expect((drivers.claude_code as ClaudeCodeDriver).command).toBe('/opt/bin/claude');
    expect((drivers.codex as CodexDriver).command).toBe('/opt/bin/codex');
    expect(harnessVersions(clis)).toEqual({
      claude_code: '2.1.319 (Claude Code)',
      codex: 'codex-cli 0.163.0',
    });
    expect(harnessDrivers({})).toEqual({});
    expect(harnessVersions({ codex: clis.codex })).toEqual({ claude_code: null, codex: 'codex-cli 0.163.0' });
    expect(HARNESS_COMMANDS).toEqual({ claude_code: 'claude', codex: 'codex' });
    expect(drivers.codex).toBeInstanceOf(CodexDriver);
  });

  it('offer the runner’s MCP server to each turn, its sockets under the state folder, when the daemon has it', () => {
    const stateDir = join(tempDir(), 's');
    const machine = { clis: {}, env: {}, fs: nodePrivateFs(), stateDir };
    const host = harnessHost({ ...machine, tools: TOOL_SERVER }, memoryLog().log);
    expect(host.ask).toMatchObject(TOOL_SERVER);
    const bridge = host.ask?.open();
    expect(bridge?.dir.startsWith(`${turnsRoot(stateDir)}/`)).toBe(true);
    bridge?.close();
    expect(harnessHost(machine, memoryLog().log).ask).toBeUndefined();
  });
});
