import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CodexDriver } from '@mwc/harness-codex';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it, vi } from 'vitest';
import { FAKE_COMMAND, fakeHarnessHost, startTurn as start, turnsWorld } from '../../fixtures/turns.ts';

describe("a turn's standing instructions", () => {
  const INSTRUCTIONS = '## Your place in the company\n\n- You are QA.';

  it('are a Claude Code file named by --append-system-prompt-file while the process runs, gone after', async () => {
    const drivers = { claude_code: new ClaudeCodeDriver({ command: FAKE_COMMAND }) };
    const { host, cwd } = fakeHarnessHost({ drivers });
    const w = turnsWorld({ host });
    let during: string | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      const args = w.spawn.calls[0]?.args as string[];
      during = readFileSync(args[args.indexOf('--append-system-prompt-file') + 1] as string, 'utf8');
      child.finish('', 0);
    });
    start(w, fakeTurnSpec('claude_code', { cwd, instructions: INSTRUCTIONS }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const args = w.spawn.calls[0]?.args as string[];
    expect(during).toBe(INSTRUCTIONS);
    expect(args.slice(-4)).toEqual([
      '--settings',
      expect.stringMatching(/settings-[0-9a-f]{12}\.json$/),
      '--append-system-prompt-file',
      expect.stringMatching(/instructions-[0-9a-f]{12}\.md$/),
    ]);
    expect(args).toContain('off');
    expect(existsSync(args.at(-1) as string)).toBe(false);
  });

  it('are the Codex home’s AGENTS.override.md while the process runs, gone after', async () => {
    const { host, cwd } = fakeHarnessHost({ drivers: { codex: new CodexDriver({ command: FAKE_COMMAND }) } });
    const w = turnsWorld({ host });
    let during: string | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      during = readFileSync(
        join(w.spawn.calls[0]?.options.env?.CODEX_HOME as string, 'AGENTS.override.md'),
        'utf8',
      );
      child.finish('', 0);
    });
    start(w, fakeTurnSpec('codex', { cwd, instructions: INSTRUCTIONS }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(during).toBe(INSTRUCTIONS);
    const home = w.spawn.calls[0]?.options.env?.CODEX_HOME as string;
    expect(existsSync(join(home, 'AGENTS.override.md'))).toBe(false);
  });
});
