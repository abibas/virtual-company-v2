import { fakeTerminalSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import { CODEX_INSTRUCTIONS_FILE, codexInstructionsFiles } from '../src/instructions.ts';

describe('standing instructions on Codex', () => {
  it('are none without them', () => {
    expect(codexInstructionsFiles(fakeTerminalSpec('codex'))).toEqual([]);
  });

  it('are the global instructions file of the Codex home, 0600, found by Codex itself', () => {
    expect(codexInstructionsFiles(fakeTerminalSpec('codex', { instructions: 'You are QA.' }))).toEqual([
      { name: 'AGENTS.override.md', contents: 'You are QA.', mode: 0o600 },
    ]);
    expect(CODEX_INSTRUCTIONS_FILE).toBe('AGENTS.override.md');
  });
});
