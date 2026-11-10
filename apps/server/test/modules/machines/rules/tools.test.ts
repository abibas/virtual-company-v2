import { TOOL_OUTPUT_LINES_MAX } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { installOutcome, keepLine } from '../../../../src/modules/machines/rules/tools.ts';

const CMD = '019a6c3f-8d5e-7f60-9b7c-8d9e0f1a2b3c';
const TOOLS = { claude: null, codex: 'codex-cli 0.163.0', git: null, gh: null, docker: null };

describe("an install's output", () => {
  it('keeps the most lines and the runner’s one notice after them, then drops the rest', () => {
    const lines: string[] = [];
    for (let i = 0; i < TOOL_OUTPUT_LINES_MAX + 1; i++) expect(keepLine(lines, `line ${i}`)).toBe(true);
    expect(keepLine(lines, 'one too many')).toBe(false);
    expect(lines).toHaveLength(TOOL_OUTPUT_LINES_MAX + 1);
  });
});

describe("the runner's answer to an install", () => {
  it('is its result, its tools without unknown CLIs, and its words; a runner older than installs acks it', () => {
    expect(
      installOutcome({
        type: 'tools.result',
        cmdId: CMD,
        ok: true,
        tools: { ...TOOLS, bun: '1' } as typeof TOOLS,
      }),
    ).toEqual({
      ok: true,
      tools: TOOLS,
      error: null,
    });
    expect(installOutcome({ type: 'tools.result', cmdId: CMD, ok: false })).toEqual({
      ok: false,
      tools: null,
      error: 'failed: no reason given',
    });
    expect(installOutcome({ type: 'cmd.ack', cmdId: CMD, ok: false, error: 'unknown' })).toEqual({
      ok: false,
      tools: null,
      error: 'runner_outdated: the runner does not know installs; update it',
    });
  });
});
