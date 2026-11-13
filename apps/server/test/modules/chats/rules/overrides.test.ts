import type { AiPartRow, Chat } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import {
  OVERRIDES_UNSUPPORTED,
  overridesOf,
  overridesRefusal,
  partRuns,
  ranWith,
  takesOverrides,
  turnRuns,
} from '../../../../src/modules/chats/rules/overrides.ts';

const claudePart: AiPartRow = {
  credentialId: 'c1',
  gatewayCredentialId: null,
  model: 'claude-opus-5-5',
  effort: 'high',
  mode: 'manual',
};
const codexPart: AiPartRow = { ...claudePart, model: 'gpt-6.1-sol', effort: 'ultra', mode: 'ask' };

/** A message chat with these overrides (none by default). */
const chat = (values: Partial<Chat> = {}) =>
  ({ taskId: null, flowId: null, mode: null, model: null, effort: null, ...values }) as Chat;

describe('which chats take overrides', () => {
  it('a message chat only: never a task’s conversation or a flow’s team chat', () => {
    expect(takesOverrides(chat())).toBe(true);
    expect(takesOverrides(chat({ taskId: 't1' }))).toBe(false);
    expect(takesOverrides(chat({ flowId: 'f1' }))).toBe(false);
    expect(OVERRIDES_UNSUPPORTED).toMatchObject({ status: 409, code: 'overrides_unsupported' });
  });
});

describe('what a turn runs', () => {
  it("is the profile's part without overrides", () => {
    expect(turnRuns(chat(), 'claude', claudePart)).toEqual(partRuns(claudePart));
    expect(partRuns(claudePart)).toEqual({ mode: 'manual', model: 'claude-opus-5-5', effort: 'high' });
  });

  it("takes a message chat's overrides over the profile's", () => {
    const own = { mode: 'plan', model: 'claude-sonnet-5-5', effort: 'low' } as const;
    expect(turnRuns(chat(own), 'claude', claudePart)).toEqual(own);
    expect(turnRuns(chat({ mode: 'acceptEdits' }), 'claude', claudePart)).toEqual({
      ...partRuns(claudePart),
      mode: 'acceptEdits',
    });
    expect(overridesOf(chat(own))).toEqual(own);
  });

  it("ignores them in a task's or a team's conversation: the step and the Lead run on the profile's", () => {
    const own = { mode: 'bypassPermissions', model: 'claude-haiku-5-5', effort: 'max' } as const;
    expect(turnRuns(chat({ ...own, taskId: 't1' }), 'claude', claudePart)).toEqual(partRuns(claudePart));
    expect(turnRuns(chat({ ...own, flowId: 'f1' }), 'claude', claudePart)).toEqual(partRuns(claudePart));
  });

  it('passes over overrides of another AI, and an effort the model it runs does not take', () => {
    expect(turnRuns(chat({ mode: 'plan', model: 'claude-opus-5-5' }), 'openai', codexPart)).toEqual(
      partRuns(codexPart),
    );
    // GPT-5.5 takes low to xhigh: the profile's ultra gives way to the default.
    expect(turnRuns(chat({ model: 'gpt-5.5' }), 'openai', codexPart)).toEqual({
      mode: 'ask',
      model: 'gpt-5.5',
      effort: null,
    });
  });

  it('records what the spec ran with', () => {
    expect(ranWith({ permissionMode: 'plan', model: 'claude-opus-5-5', effort: 'high' })).toEqual({
      mode: 'plan',
      model: 'claude-opus-5-5',
      effort: 'high',
    });
    expect(ranWith({ model: null })).toEqual({ mode: null, model: null, effort: null });
  });
});

describe('overridesRefusal', () => {
  const none = { mode: null, model: null, effort: null };

  it('takes overrides that fit, and none', () => {
    expect(overridesRefusal('claude', none, null)).toBeUndefined();
    expect(
      overridesRefusal('claude', { mode: 'auto', model: 'claude-fable-5-1', effort: 'max' }, null),
    ).toBeUndefined();
    expect(
      overridesRefusal('openai', { mode: 'full', model: null, effort: 'ultra' }, 'gpt-6.1-sol'),
    ).toBeUndefined();
  });

  it('refuses a mode of the other harness, naming its own', () => {
    expect(overridesRefusal('openai', { ...none, mode: 'plan' }, null)).toEqual({
      ok: false,
      status: 422,
      code: 'mode_unsupported',
      message: "plan is not one of Codex's modes: Ask, Auto, Full trust",
    });
    expect(overridesRefusal('claude', { ...none, mode: 'full' }, null)?.code).toBe('mode_unsupported');
  });

  it("refuses a model outside its provider's catalogue, typed-in ones too", () => {
    expect(overridesRefusal('claude', { ...none, model: 'gpt-6.1-sol' }, null)).toMatchObject({
      code: 'model_unsupported',
      message: "gpt-6.1-sol is not one of Claude's models: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1",
    });
    expect(overridesRefusal('openai', { ...none, model: 'gpt-7-preview' }, null)?.code).toBe(
      'model_unsupported',
    );
  });

  it("refuses an effort the chat's model, else the profile's, does not take", () => {
    expect(overridesRefusal('openai', { ...none, model: 'gpt-5.5', effort: 'ultra' }, null)).toMatchObject({
      code: 'effort_unsupported',
      message: 'GPT-5.5 takes the efforts low, medium, high, xhigh, not ultra',
    });
    expect(overridesRefusal('openai', { ...none, effort: 'ultra' }, 'gpt-5.5')?.code).toBe(
      'effort_unsupported',
    );
    expect(overridesRefusal('claude', { ...none, effort: 'ultra' }, null)?.message).toBe(
      "Claude's default takes the efforts low, medium, high, xhigh, max, not ultra",
    );
  });
});
