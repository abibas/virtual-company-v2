import { describe, expect, it } from 'vitest';
import { ClaudeMode, CodexMode, PermissionMode } from '../src/enums.ts';
import {
  chatRuns,
  DEFAULT_MODES,
  fitsHarness,
  isModeOf,
  MODES,
  modeChoice,
  modeOfPolicy,
  NO_OVERRIDES,
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

describe('chatRuns', () => {
  const profile = { mode: 'manual', model: 'claude-opus-5-5', effort: 'high' } as const;

  it("is the profile's without overrides, and takes each override that fits", () => {
    expect(chatRuns('claude', profile, NO_OVERRIDES)).toEqual(profile);
    expect(chatRuns('claude', profile, { mode: 'plan', model: null, effort: null })).toEqual({
      ...profile,
      mode: 'plan',
    });
    expect(chatRuns('claude', profile, { mode: null, model: 'claude-haiku-5-5', effort: 'low' })).toEqual({
      mode: 'manual',
      model: 'claude-haiku-5-5',
      effort: 'low',
    });
  });

  it('passes over an override of another AI, and an effort the model does not take', () => {
    expect(chatRuns('claude', profile, { mode: 'full', model: 'gpt-6.1-sol', effort: 'ultra' })).toEqual(
      profile,
    );
    const codex = { mode: 'auto', model: 'gpt-6.1-sol', effort: 'ultra' } as const;
    // GPT-5.5 takes low to xhigh: the chat's ultra and the profile's ultra give way to the default.
    expect(chatRuns('openai', codex, { mode: null, model: 'gpt-5.5', effort: null })).toEqual({
      mode: 'auto',
      model: 'gpt-5.5',
      effort: null,
    });
    expect(chatRuns('openai', codex, { mode: null, model: 'gpt-5.5', effort: 'max' })).toMatchObject({
      effort: null,
    });
    expect(
      chatRuns('openai', { ...codex, effort: 'high' }, { mode: null, model: 'gpt-5.5', effort: 'ultra' }),
    ).toMatchObject({ effort: 'high' });
  });
});
