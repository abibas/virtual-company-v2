import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CodexDriver } from '@mwc/harness-codex';
import { describe, expect, it } from 'vitest';
import { HARNESS_COMMANDS, harnessDrivers, harnessVersions } from '../../src/turns/drivers.ts';

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
});
