import { describe, expect, it } from 'vitest';
import {
  endedTurn,
  harnessMissing,
  isLive,
  profileEmpty,
  titleOf,
  turnEffort,
  turnModel,
  withEvent,
} from '../../../src/modules/chats/rules.ts';

describe('titleOf', () => {
  it('puts the first prompt on one line and cuts it to 80 characters', () => {
    expect(titleOf('  What is\n2 + 2?  ')).toBe('What is 2 + 2?');
    const long = titleOf(`${'word '.repeat(30)}end`);
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
    expect(titleOf(' \n ')).toBe('Chat');
  });
});

describe('a turn’s end', () => {
  const result = { type: 'result', ok: true, text: '4' } as const;
  const usage = { type: 'usage', inputTokens: 5, outputTokens: 1 } as const;

  it('keeps the last result and usage of the events', () => {
    const outcome = [usage, { type: 'text', text: 'x' } as const, result].reduce(withEvent, {});
    expect(outcome).toEqual({ result, usage });
  });

  it('is done with the reply and usage, failed with the reason, stopped when a person stopped it', () => {
    expect(endedTurn({ ok: true }, { result, usage }, false)).toEqual({
      status: 'done',
      resultText: '4',
      error: null,
      usage: { inputTokens: 5, outputTokens: 1 },
    });
    expect(endedTurn({ ok: false, error: 'busy' }, {}, false)).toMatchObject({
      status: 'failed',
      error: 'busy',
    });
    const failed = { type: 'result', ok: false, error: 'exited with code 1' } as const;
    expect(endedTurn({ ok: false }, { result: failed }, false)).toMatchObject({
      error: 'exited with code 1',
    });
    expect(endedTurn({ ok: false }, {}, false)).toMatchObject({ error: 'The turn failed', usage: null });
    expect(endedTurn({ ok: true }, { result }, true)).toMatchObject({ status: 'stopped', resultText: '4' });
    expect(endedTurn({ ok: false, error: 'stopped' }, {}, false)).toMatchObject({ status: 'stopped' });
  });

  it('marks the usage of a turn on a login or setup token as included in the plan, not one on an API key', () => {
    const plan = { inputTokens: 5, outputTokens: 1, includedInPlan: true };
    for (const kind of ['claude_oauth', 'claude_setup_token', 'codex_oauth'] as const) {
      expect(endedTurn({ ok: true }, { result, usage }, false, kind).usage).toEqual(plan);
    }
    const paid = { ...usage, costUsd: 0.25 };
    for (const kind of ['anthropic_api_key', 'openai_api_key', 'gateway'] as const) {
      expect(endedTurn({ ok: true }, { result, usage: paid }, false, kind).usage).toEqual({
        inputTokens: 5,
        outputTokens: 1,
        costUsd: 0.25,
      });
    }
    expect(endedTurn({ ok: true }, { result }, false, 'codex_oauth').usage).toBeNull();
  });

  it('counts queued and running turns as live', () => {
    expect(['queued', 'running', 'done', 'failed', 'stopped'].map((s) => isLive(s as never))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('the refusals that name what to fix', () => {
  it('name the harness and the profile', () => {
    expect(harnessMissing('claude_code').message).toContain('Claude Code');
    expect(profileEmpty('Work')).toMatchObject({
      status: 422,
      code: 'profile_empty',
      message: expect.stringContaining('Work has no subscription'),
    });
  });
});

describe('turnModel', () => {
  it('hands Codex its own default for the marker or a Claude id, and Claude Code its model', () => {
    expect(turnModel('codex', 'codex-default')).toBeNull();
    expect(turnModel('codex', 'claude-opus-5-5')).toBeNull();
    expect(turnModel('codex', 'gpt-6.1-sol')).toBe('gpt-6.1-sol');
    expect(turnModel('claude_code', 'claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(turnModel('claude_code', 'codex-default')).toBeNull();
    expect(turnModel('claude_code', 'claude opus')).toBe('claude opus');
    expect(turnModel('codex', null)).toBeNull();
    expect(turnModel('claude_code', null)).toBeNull();
  });
});

describe('turnEffort', () => {
  it("hands each harness the profile's effort when it takes that level, else none (its own default)", () => {
    expect(turnEffort('codex', 'ultra')).toBe('ultra');
    expect(turnEffort('claude_code', 'max')).toBe('max');
    expect(turnEffort('claude_code', 'ultra')).toBeUndefined();
    expect(turnEffort('codex', null)).toBeUndefined();
  });
});
