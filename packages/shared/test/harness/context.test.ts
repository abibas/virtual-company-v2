import { describe, expect, it } from 'vitest';
import { CONTEXT_WINDOWS, contextWindowOf } from '../../src/harness/context.ts';

describe('contextWindowOf', () => {
  it('knows the Claude 5 family, the 4.6+ models at 1M and the older ones at 200k', () => {
    for (const model of [
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-sonnet-5-5',
      'claude-sonnet-5',
      'claude-haiku-5-5',
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-mythos-5-1',
      'claude-opus-4-8',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ]) {
      expect(contextWindowOf(model)).toBe(1_000_000);
    }
    for (const model of ['claude-opus-4-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5'])
      expect(contextWindowOf(model)).toBe(200_000);
  });

  it("reads Claude Code's aliases, a [1m] suffix, Bedrock and router prefixes, and any case", () => {
    for (const model of ['opus', 'sonnet', 'haiku', 'fable', 'opusplan', 'Claude-Opus-5-5'])
      expect(contextWindowOf(model)).toBe(1_000_000);
    expect(contextWindowOf('claude-sonnet-4-5[1m]')).toBe(1_000_000);
    expect(contextWindowOf('us.anthropic.claude-opus-4-5-20251101-v1:0')).toBe(200_000);
    expect(contextWindowOf('anthropic.claude-opus-5-5')).toBe(1_000_000);
    expect(contextWindowOf('anthropic/claude-haiku-4-5')).toBe(200_000);
    expect(contextWindowOf(' claude-opus-4-5@20251101 ')).toBe(200_000);
  });

  it('sizes the GPT and Codex models as Codex does', () => {
    for (const model of ['gpt-5', 'gpt-5-codex', 'gpt-5.6-codex', 'gpt-5-mini', 'openai/gpt-5'])
      expect(contextWindowOf(model)).toBe(272_000);
    expect(contextWindowOf('gpt-4.1')).toBe(1_047_576);
    expect(contextWindowOf('o3')).toBe(200_000);
    expect(contextWindowOf('o4-mini')).toBe(200_000);
    expect(contextWindowOf('codex-mini-latest')).toBe(200_000);
    expect(contextWindowOf('gpt-oss-120b')).toBe(131_072);
  });

  it('is null for no model and for one it does not know', () => {
    for (const model of [null, undefined, '', '   ', 'llama-4', 'gpt-4o', 'claude-3-opus'])
      expect(contextWindowOf(model)).toBeNull();
  });

  it('lists each prefix once', () => {
    const prefixes = CONTEXT_WINDOWS.map(([prefix]) => prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
