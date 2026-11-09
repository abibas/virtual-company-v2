import { describe, expect, it } from 'vitest';
import {
  endedTurn,
  HARNESS_SLOT,
  harnessMissing,
  isLive,
  profileSlotEmpty,
  titleOf,
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
  it('name the harness and the slot', () => {
    expect(HARNESS_SLOT).toEqual({ claude_code: 'claude', codex: 'openai' });
    expect(harnessMissing('claude_code').message).toContain('Claude Code');
    expect(profileSlotEmpty('openai')).toMatchObject({ status: 422, code: 'profile_slot_empty' });
  });
});
