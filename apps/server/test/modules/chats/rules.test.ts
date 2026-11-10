import type { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import {
  conversationState,
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

describe('conversationState', () => {
  const at = (n: number) => `2026-11-09T12:00:0${n}.000Z`;
  const turn = (kind: 'message' | 'compact' | 'clear', ...events: TurnEvent[]) => ({
    kind,
    events: events.map((event, i) => ({ event, at: at(i) })),
  });
  const init = (model: string | null): TurnEvent => ({ type: 'init', model });
  const context = (read: number, window: number | null): TurnEvent => ({
    type: 'context',
    inputTokens: 3,
    cacheReadTokens: read,
    cacheCreationTokens: 100,
    outputTokens: 9,
    window,
  });

  it('is empty before anything measured the conversation', () => {
    expect(conversationState([])).toEqual({ init: null, context: null });
    expect(conversationState([turn('message', { type: 'text', text: 'Hi' })])).toEqual({
      init: null,
      context: null,
    });
  });

  it('takes the last init and the last request’s size, with its window or the model table’s', () => {
    const state = conversationState([
      turn('message', init('claude-haiku-4-5'), context(1000, null)),
      turn('message', init('claude-opus-5-5'), context(5000, null), context(6000, 900_000)),
    ]);
    expect(state.init).toEqual(init('claude-opus-5-5'));
    expect(state.context).toEqual({ usedTokens: 6103, window: 900_000, model: 'claude-opus-5-5', at: at(2) });
    expect(
      conversationState([turn('message', init('claude-haiku-4-5'), context(1000, null))]).context,
    ).toEqual({
      usedTokens: 1103,
      window: 200_000,
      model: 'claude-haiku-4-5',
      at: at(1),
    });
  });

  it('takes a later compaction’s size, keeping the window, and ignores one that did not say it', () => {
    const compacted = conversationState([
      turn('message', init('opus'), context(150_000, 1_000_000)),
      turn('compact', { type: 'compact', preTokens: 150_103, postTokens: 20_000, trigger: 'manual' }),
    ]);
    expect(compacted.context).toEqual({ usedTokens: 20_000, window: 1_000_000, model: 'opus', at: at(0) });
    const unknown = conversationState([
      turn('message', context(150_000, null)),
      turn('compact', { type: 'compact', preTokens: 150_103, postTokens: null }),
    ]);
    expect(unknown.context).toMatchObject({ usedTokens: 150_103, window: null, model: null });
    const fresh = conversationState([turn('compact', { type: 'compact', preTokens: 9, postTokens: 4 })]);
    expect(fresh.context).toEqual({ usedTokens: 4, window: null, model: null, at: at(0) });
  });

  it("falls back to the window of what the chat's profile runs when the events and the model table say none", () => {
    const unknownModel = [turn('message', init('llama-4'), context(1000, null))];
    expect(conversationState(unknownModel, 272_000).context).toMatchObject({ window: 272_000 });
    expect(conversationState(unknownModel).context).toMatchObject({ window: null });
    const known = [turn('message', init('claude-haiku-4-5'), context(1000, null))];
    expect(conversationState(known, 1_000_000).context).toMatchObject({ window: 200_000 });
    const compactOnly = [turn('compact', { type: 'compact', preTokens: 9, postTokens: 4 })];
    expect(conversationState(compactOnly, 272_000).context).toMatchObject({ usedTokens: 4, window: 272_000 });
  });

  it("keeps an estimate from a turn's total (Codex) marked, sized by the profile's window without a model", () => {
    const estimate: TurnEvent = {
      type: 'context',
      inputTokens: 7834,
      cacheReadTokens: 37_376,
      cacheCreationTokens: 0,
      outputTokens: 262,
      window: null,
      estimate: true,
    };
    expect(conversationState([turn('message', estimate)], 272_000).context).toEqual({
      usedTokens: 45_210,
      window: 272_000,
      model: null,
      at: at(0),
      estimate: true,
    });
    const exact = conversationState([turn('message', estimate, context(1000, 200_000))]).context;
    expect(exact).not.toHaveProperty('estimate');
  });

  it('starts over after a Clear', () => {
    const before = turn('message', init('opus'), context(150_000, 1_000_000));
    expect(conversationState([before, turn('clear')])).toEqual({ init: null, context: null });
    expect(conversationState([before, turn('clear'), turn('message', init('sonnet'))])).toEqual({
      init: init('sonnet'),
      context: null,
    });
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
