import { fakeTerminalSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_OPTION, instructionsFile, SNAPSHOT_OFF, snapshotArgs } from '../src/instructions.ts';

describe('standing instructions on Claude Code', () => {
  it('need no file and no argument without them', () => {
    const spec = fakeTerminalSpec('claude_code');
    expect(instructionsFile(spec)).toBeUndefined();
    expect(instructionsFile(spec, 'extra')).toBeUndefined();
    expect(snapshotArgs(spec)).toEqual([]);
  });

  it('are a 0600 file of its own named with --append-system-prompt-file, with any extra line after them', () => {
    const spec = fakeTerminalSpec('claude_code', { instructions: 'You are QA.' });
    const file = instructionsFile(spec, 'Ask with the tool.');
    expect(file).toEqual({
      name: expect.stringMatching(/^instructions-[0-9a-f]{12}\.md$/),
      contents: 'You are QA.\n\nAsk with the tool.',
      mode: 0o600,
      option: INSTRUCTIONS_OPTION,
    });
    expect(INSTRUCTIONS_OPTION).toBe('--append-system-prompt-file');
    expect(instructionsFile(spec)?.contents).toBe('You are QA.');
  });

  it('turn the recorded system prompt off, so a resumed conversation gets the new text', () => {
    const spec = fakeTerminalSpec('claude_code', { instructions: 'You are QA.' });
    expect(snapshotArgs(spec)).toEqual(SNAPSHOT_OFF);
    expect(SNAPSHOT_OFF).toEqual(['--system-prompt-snapshot', 'off']);
  });
});
