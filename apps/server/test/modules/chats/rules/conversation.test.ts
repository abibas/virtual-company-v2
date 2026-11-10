import type { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { conversationState } from '../../../../src/modules/chats/rules/conversation.ts';

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

  it("reads Codex's own reading as /status does: its total, its window, its model and its baseline, over an older estimate", () => {
    const estimate: TurnEvent = {
      type: 'context',
      inputTokens: 24_000,
      cacheReadTokens: 225_000,
      cacheCreationTokens: 0,
      outputTokens: 1500,
      window: null,
      estimate: true,
    };
    const reading: TurnEvent = {
      type: 'context',
      inputTokens: 2257,
      cacheReadTokens: 33_152,
      cacheCreationTokens: 0,
      outputTokens: 456,
      window: 475_000,
      usedTokens: 35_865,
      model: 'gpt-6.1-sol',
      baselineTokens: 12_000,
    };
    const state = conversationState([turn('message', estimate), turn('message', reading)], 258_400);
    expect(state.context).toEqual({
      usedTokens: 35_865,
      window: 475_000,
      model: 'gpt-6.1-sol',
      at: at(0),
      baselineTokens: 12_000,
    });
    const unsized = { ...reading, window: null } as TurnEvent;
    expect(conversationState([turn('message', unsized)]).context).toMatchObject({
      window: 475_000,
      model: 'gpt-6.1-sol',
    });
    const compacted = conversationState([
      turn('message', reading),
      turn('compact', { type: 'compact', preTokens: 35_865, postTokens: 9000 }),
    ]);
    expect(compacted.context).toEqual({ usedTokens: 9000, window: 475_000, model: 'gpt-6.1-sol', at: at(0) });
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
