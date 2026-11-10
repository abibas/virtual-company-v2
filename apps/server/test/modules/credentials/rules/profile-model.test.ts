import { describe, expect, it } from 'vitest';
import { runsAfter, runsRefusal } from '../../../../src/modules/credentials/rules/profile-model.ts';

describe('runsRefusal', () => {
  it("takes the provider's default, a catalogue model of its own at a level it takes, and a typed-in id", () => {
    expect(runsRefusal('claude', { model: null, effort: null })).toBeUndefined();
    expect(runsRefusal('claude', { model: 'claude-opus-5-5', effort: 'max' })).toBeUndefined();
    expect(runsRefusal('openai', { model: 'gpt-6.1-sol', effort: 'ultra' })).toBeUndefined();
    expect(runsRefusal('openai', { model: null, effort: 'ultra' })).toBeUndefined();
    expect(runsRefusal('openai', { model: 'gpt-7-preview', effort: 'low' })).toBeUndefined();
    expect(runsRefusal('claude', { model: 'llama-4', effort: 'high' })).toBeUndefined();
  });

  it('refuses a model of the other provider', () => {
    expect(runsRefusal('openai', { model: 'claude-opus-5-5', effort: null })).toEqual({
      ok: false,
      status: 422,
      code: 'model_provider_mismatch',
      message: "claude-opus-5-5 is a Claude model; an OpenAI profile runs OpenAI's models",
    });
    expect(runsRefusal('claude', { model: 'gpt-6.1-sol', effort: null })).toMatchObject({
      code: 'model_provider_mismatch',
      message: "gpt-6.1-sol is an OpenAI model; a Claude profile runs Claude's models",
    });
  });

  it('refuses an effort the model, or else the provider, does not take, naming the levels it does', () => {
    expect(runsRefusal('openai', { model: 'gpt-5.5', effort: 'max' })).toEqual({
      ok: false,
      status: 422,
      code: 'effort_unsupported',
      message: 'GPT-5.5 takes the efforts low, medium, high, xhigh, not max',
    });
    expect(runsRefusal('openai', { model: 'gpt-6-luna', effort: 'ultra' })?.code).toBe('effort_unsupported');
    expect(runsRefusal('claude', { model: null, effort: 'ultra' })?.message).toBe(
      "Claude's default takes the efforts low, medium, high, xhigh, max, not ultra",
    );
    expect(runsRefusal('claude', { model: 'claude-next', effort: 'ultra' })?.message).toBe(
      'Claude takes the efforts low, medium, high, xhigh, max, not ultra',
    );
  });
});

describe('runsAfter', () => {
  it("is the change's model and effort where it gives them (null too), else the profile's", () => {
    const profile = { model: 'gpt-6.1-sol', effort: 'high' as const };
    expect(runsAfter(profile, {})).toEqual(profile);
    expect(runsAfter(profile, { model: null })).toEqual({ model: null, effort: 'high' });
    expect(runsAfter(profile, { effort: 'ultra' })).toEqual({ model: 'gpt-6.1-sol', effort: 'ultra' });
  });
});
