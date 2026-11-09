import { describe, expect, it } from 'vitest';
import { contextEvents, forgetContext, resultContext } from '../src/context.ts';
import { newClaudeState } from '../src/state.ts';

const usage = {
  input_tokens: 3,
  cache_read_input_tokens: 14000,
  cache_creation_input_tokens: 1200,
  output_tokens: 20,
};

const message = (fields: Record<string, unknown>, parent: string | null = null) => ({
  type: 'assistant',
  message: { id: 'msg_1', model: 'claude-opus-5-5', content: [], usage, ...fields },
  parent_tool_use_id: parent,
});

const context = (window: number | null, fields: Record<string, number> = {}) => ({
  type: 'context',
  inputTokens: 3,
  cacheReadTokens: 14000,
  cacheCreationTokens: 1200,
  outputTokens: 20,
  window,
  ...fields,
});

describe('contextEvents', () => {
  it('gives the last request’s tokens and the window of the model init named, once per message', () => {
    const state = newClaudeState();
    state.model = 'claude-sonnet-4-5[1m]';
    expect(contextEvents(message({ model: 'claude-sonnet-4-5' }), state)).toEqual([context(1_000_000)]);
    expect(contextEvents(message({ model: 'claude-sonnet-4-5' }), state)).toEqual([]);
    expect(contextEvents(message({ id: 'msg_2' }), state)).toEqual([context(1_000_000)]);
    expect(state.model).toBe('claude-sonnet-4-5[1m]');
  });

  it('takes the model of the first message without init, and null for a model it does not know', () => {
    const state = newClaudeState();
    expect(contextEvents(message({ model: 'claude-haiku-4-5' }), state)).toEqual([context(200_000)]);
    expect(state.model).toBe('claude-haiku-4-5');
    const unknown = newClaudeState();
    expect(contextEvents(message({ model: 'llama' }), unknown)).toEqual([context(null)]);
    expect(contextEvents(message({ model: undefined, id: 'msg_x' }), newClaudeState())).toEqual([
      context(null),
    ]);
  });

  it('gives nothing for a subagent’s message, Claude Code’s own, or one without usage', () => {
    const state = newClaudeState();
    expect(contextEvents(message({}, 'toolu_a'), state)).toEqual([]);
    expect(contextEvents(message({ model: '<synthetic>' }), state)).toEqual([]);
    expect(contextEvents(message({ usage: undefined }), state)).toEqual([]);
    expect(contextEvents(message({ usage: { output_tokens: 3 } }), state)).toEqual([]);
    expect(contextEvents({ type: 'assistant' }, state)).toEqual([]);
    expect(contextEvents(message({ usage: { input_tokens: 5 } }), state)).toEqual([
      context(1_000_000, { inputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 }),
    ]);
  });
});

describe('resultContext', () => {
  const after = (
    modelUsage: unknown,
    model: string | null = 'claude-opus-5-5',
    window: number | null = null,
  ) => {
    const state = newClaudeState();
    state.model = model;
    state.context = context(window) as never;
    return { events: resultContext({ type: 'result', modelUsage }, state), state };
  };

  it('gives the last context again with the window Claude Code reported for the main model', () => {
    const reported = {
      'claude-opus-5-5': { contextWindow: 1_000_000 },
      'claude-haiku-5-5': { contextWindow: 5 },
    };
    const { events, state } = after(reported);
    expect(events).toEqual([context(1_000_000)]);
    expect(state.context?.window).toBe(1_000_000);
    expect(after({ 'claude-opus-5-5[1m]': { contextWindow: 900_000 } }).events).toEqual([context(900_000)]);
    expect(after({ only: { contextWindow: 700_000 } }, null).events).toEqual([context(700_000)]);
  });

  it('gives nothing when it says nothing new, nothing usable, or less than the conversation holds', () => {
    expect(
      after({ 'claude-opus-5-5': { contextWindow: 1_000_000 } }, 'claude-opus-5-5', 1_000_000).events,
    ).toEqual([]);
    expect(after({ 'claude-opus-5-5': { contextWindow: 10_000 } }).events).toEqual([]);
    expect(after({ 'claude-opus-5-5': { contextWindow: 0 } }).events).toEqual([]);
    expect(after({ 'claude-opus-5-5': 'x' }).events).toEqual([]);
    expect(after({ a: { contextWindow: 1 }, b: { contextWindow: 2 } }, null).events).toEqual([]);
    expect(after({ a: { contextWindow: 300_000 }, b: {} }).events).toEqual([]);
    expect(after(undefined).events).toEqual([]);
    expect(
      resultContext({ type: 'result', modelUsage: { m: { contextWindow: 9 } } }, newClaudeState()),
    ).toEqual([]);
  });
});

describe('forgetContext', () => {
  it('forgets the last context, so the next message measures again', () => {
    const state = newClaudeState();
    contextEvents(message({}), state);
    forgetContext(state);
    expect(state.context).toBeUndefined();
    expect(contextEvents(message({}), state)).toHaveLength(1);
  });
});
