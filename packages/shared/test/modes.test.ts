import { describe, expect, it } from 'vitest';
import { ClaudeMode, CodexMode, PermissionMode } from '../src/enums.ts';
import {
  DEFAULT_MODES,
  fitsHarness,
  isModeOf,
  MODES,
  modeChoice,
  modeOfPolicy,
  PROVIDER_MODES,
  policyOfMode,
} from '../src/modes.ts';

describe('the permission modes', () => {
  it("lists Claude Code's five and Codex's three, in the menus' order, each with its words", () => {
    expect(MODES.claude.map(({ id, label }) => [id, label])).toEqual([
      ['manual', 'Manual'],
      ['acceptEdits', 'Accept edits'],
      ['plan', 'Plan'],
      ['auto', 'Auto'],
      ['bypassPermissions', 'Skip prompts (full trust)'],
    ]);
    expect(MODES.openai.map(({ id, label }) => [id, label])).toEqual([
      ['ask', 'Ask'],
      ['auto', 'Auto'],
      ['full', 'Full trust'],
    ]);
    for (const choice of [...MODES.claude, ...MODES.openai]) {
      expect(choice.short.length).toBeLessThanOrEqual(10);
      expect(choice.description).toMatch(/^[A-Z].{10,60}$/);
    }
    expect(MODES.claude.map((choice) => choice.id)).toEqual(ClaudeMode.options);
    expect(MODES.openai.map((choice) => choice.id)).toEqual(CodexMode.options);
    expect(PROVIDER_MODES).toEqual({ claude: ClaudeMode, openai: CodexMode });
    for (const mode of PermissionMode.options) {
      expect(isModeOf('claude', mode) || isModeOf('openai', mode)).toBe(true);
    }
  });

  it('starts a part on Manual (Claude) or Ask (OpenAI)', () => {
    expect(DEFAULT_MODES).toEqual({ claude: 'manual', openai: 'ask' });
  });

  it("tells a part's or a harness's modes from the other's", () => {
    expect(isModeOf('claude', 'plan')).toBe(true);
    expect(isModeOf('openai', 'plan')).toBe(false);
    expect(isModeOf('openai', 'auto')).toBe(true);
    expect(isModeOf('claude', 'auto')).toBe(true);
    expect(isModeOf('claude', 'full')).toBe(false);
    expect(isModeOf('claude', 'default')).toBe(false);
    expect(fitsHarness('claude_code', 'acceptEdits')).toBe(true);
    expect(fitsHarness('codex', 'acceptEdits')).toBe(false);
    expect(fitsHarness('codex', 'full')).toBe(true);
    expect(modeChoice('claude', 'plan')?.label).toBe('Plan');
    expect(modeChoice('openai', 'plan')).toBeUndefined();
  });

  it('comes to the old two-way setting for an older runner, and back to what it meant (Codex asked in its workspace)', () => {
    expect(PermissionMode.options.filter((mode) => policyOfMode(mode) === 'bypass')).toEqual([
      'bypassPermissions',
      'full',
    ]);
    expect(policyOfMode('auto')).toBe('ask');
    expect(modeOfPolicy('claude_code', 'ask')).toBe('manual');
    expect(modeOfPolicy('claude_code', 'bypass')).toBe('bypassPermissions');
    expect(modeOfPolicy('codex', 'ask')).toBe('auto');
    expect(modeOfPolicy('codex', 'bypass')).toBe('full');
  });
});
