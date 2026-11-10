import { describe, expect, it } from 'vitest';
import { CODEX_BASELINE_TOKENS, rateLimitsOf, readingEvent, scanReading } from '../src/reading.ts';
import {
  NO_LIMITS,
  PLAN_LIMITS,
  READING,
  TURN_LINES,
  tokenCount,
  turnContext,
  usage,
} from './fixtures/rollout.ts';

describe('scanReading', () => {
  it("reads the last token_count with info and the model of the turn it belongs to, as Codex's /status", () => {
    expect(scanReading(TURN_LINES)).toEqual({ reading: READING, whole: true });
  });

  it('takes the model of the turn_context before the reading, not of a later turn that made no request yet', () => {
    const lines = [...TURN_LINES, turnContext('gpt-6-luna'), tokenCount(null)];
    expect(scanReading(lines).reading?.model).toBe('gpt-6.1-sol');
  });

  it('is not whole without the turn_context among the lines, and has no reading without a token_count', () => {
    expect(scanReading(TURN_LINES.slice(4))).toEqual({
      reading: { usage: READING.usage, window: READING.window },
      whole: false,
    });
    expect(scanReading(TURN_LINES.slice(0, 5))).toEqual({ reading: undefined, whole: false });
    expect(scanReading([])).toEqual({ reading: undefined, whole: false });
  });

  it('skips garbled lines and lines that only mention the markers, and a model id it cannot carry', () => {
    const lines = [
      turnContext('x'.repeat(201)),
      tokenCount(usage(10, 0, 1)),
      '{"type":"event_msg","payload":{"type":"token_count"',
      JSON.stringify({ type: 'response_item', payload: { type: 'message', content: '"token_count"' } }),
      JSON.stringify({ type: 'event_msg', payload: 'token_count' }),
    ];
    expect(scanReading(lines)).toEqual({
      reading: { usage: { input: 10, cached: 0, cacheWrite: 0, output: 1, total: 11 }, window: 475_000 },
      whole: true,
    });
  });

  it('fills what a token_count leaves out: no total, no window, no counts', () => {
    const line = JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 7, output_tokens: 2 }, model_context_window: 0 },
      },
    });
    expect(scanReading([line]).reading).toEqual({
      usage: { input: 7, cached: 0, cacheWrite: 0, output: 2, total: 9 },
      window: null,
    });
    const empty = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: {} } },
    });
    expect(scanReading([empty]).reading?.usage).toEqual({
      input: 0,
      cached: 0,
      cacheWrite: 0,
      output: 0,
      total: 0,
    });
    const noLast = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {} } });
    expect(scanReading([noLast]).reading).toBeUndefined();
  });

  it("carries a ChatGPT plan's limits, and none from a gateway's empty ones", () => {
    const lines = [turnContext('gpt-6.1-sol'), tokenCount(usage(100, 0, 5), 475_000, PLAN_LIMITS)];
    expect(scanReading(lines).reading?.rateLimits).toEqual({
      primary: { usedPercent: 12.5, windowMinutes: 300, resetsAt: '2026-11-10T19:00:00.000Z' },
      secondary: { usedPercent: 40, windowMinutes: 10_080, resetsAt: '2026-11-14T23:46:40.000Z' },
      planType: 'pro',
    });
    expect(scanReading(TURN_LINES).reading).not.toHaveProperty('rateLimits');
  });
});

describe('rateLimitsOf', () => {
  it('keeps what it can read of each window, and the plan alone', () => {
    expect(rateLimitsOf({ primary: { used_percent: 120 }, secondary: { used_percent: -3 } })).toEqual({
      primary: { usedPercent: 100 },
      secondary: { usedPercent: 0 },
    });
    expect(rateLimitsOf({ plan_type: ' plus ' })).toEqual({ planType: 'plus' });
    expect(rateLimitsOf({ primary: { used_percent: 5, window_minutes: 0, resets_at: 'tomorrow' } })).toEqual({
      primary: { usedPercent: 5 },
    });
  });

  it('is nothing for no limits, a window without its percentage, or a plan name too long', () => {
    for (const value of [
      undefined,
      'x',
      NO_LIMITS,
      { primary: { window_minutes: 300 } },
      { primary: 'x', secondary: { used_percent: Number.NaN } },
      { plan_type: 'x'.repeat(51) },
    ]) {
      expect(rateLimitsOf(value), JSON.stringify(value)).toBeUndefined();
    }
  });

  it('leaves out a reset time no date can hold', () => {
    expect(rateLimitsOf({ primary: { used_percent: 1, resets_at: 9e15 } })).toEqual({
      primary: { usedPercent: 1 },
    });
  });
});

describe('readingEvent', () => {
  it("is an exact context: the uncached input, cache reads and writes in bounds, Codex's total, model and baseline", () => {
    expect(readingEvent(READING)).toEqual({
      type: 'context',
      inputTokens: 2257,
      cacheReadTokens: 33_152,
      cacheCreationTokens: 0,
      outputTokens: 456,
      window: 475_000,
      usedTokens: 35_865,
      baselineTokens: CODEX_BASELINE_TOKENS,
      model: 'gpt-6.1-sol',
    });
    const odd = readingEvent({
      usage: { input: 10, cached: 8, cacheWrite: 5, output: 1, total: 11 },
      window: null,
      rateLimits: { planType: 'pro' },
    });
    expect(odd).toMatchObject({
      inputTokens: 0,
      cacheReadTokens: 8,
      cacheCreationTokens: 2,
      window: null,
      rateLimits: { planType: 'pro' },
    });
    expect(odd).not.toHaveProperty('model');
  });
});
