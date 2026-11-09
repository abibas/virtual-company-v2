import { describe, expect, it } from 'vitest';
import { INPUT_ARGS, inputEvent, isReplay, userLine } from '../src/input.ts';

const ID = '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e';

describe("Claude Code's stream-json input", () => {
  it('reads user messages from stdin and echoes the ones it takes', () => {
    expect(INPUT_ARGS).toEqual(['--input-format', 'stream-json', '--replay-user-messages']);
    expect(JSON.parse(userLine('Hi "there"\nsecond line', ID))).toEqual({
      type: 'user',
      uuid: ID,
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: 'Hi "there"\nsecond line' }] },
    });
    expect(userLine('x', ID).split('\n')).toHaveLength(2);
  });

  it('tells an echo from a tool result, and reads its text blocks only', () => {
    expect(isReplay({ type: 'user', isReplay: true })).toBe(true);
    expect(isReplay({ type: 'user' })).toBe(false);
    expect(isReplay({ type: 'assistant', isReplay: true })).toBe(false);
    const blocks = [
      { type: 'text', text: 'Use ' },
      { type: 'image' },
      'stray',
      { type: 'text', text: 'staging' },
    ];
    expect(inputEvent({ uuid: ID, message: { content: blocks } })).toEqual({
      type: 'input',
      text: 'Use staging',
      inputId: ID,
    });
  });

  it('says something for an echo with no text, and nothing for one without a uuid', () => {
    expect(inputEvent({ uuid: ID })).toEqual({ type: 'input', text: '…', inputId: ID });
    expect(inputEvent({ uuid: ID, message: { content: [{ type: 'text' }] } })?.text).toBe('…');
    expect(inputEvent({ message: { content: 'x' } })).toBeUndefined();
    expect(inputEvent({ uuid: 'x', message: { content: 'x' } })).toBeUndefined();
    expect(inputEvent({ uuid: ID, message: { content: 'y'.repeat(20_010) } })?.text).toHaveLength(20_000);
  });
});
