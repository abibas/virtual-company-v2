import { describe, expect, it } from 'vitest';
import { ClaudeLineParser } from '../src/parser.ts';

const SESSION = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';
const line = (message: object) => JSON.stringify(message);
const init = line({ type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-opus-5-5' });
const INIT = { type: 'init', model: 'claude-opus-5-5' };
const result = line({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Hi',
  session_id: SESSION,
});

describe('ClaudeLineParser.feed', () => {
  it('gives the session once, from the first message that has one', () => {
    const parser = new ClaudeLineParser();
    expect(parser.feed(init)).toEqual([{ type: 'session', sessionId: SESSION }, INIT]);
    expect(parser.feed(init)).toEqual([INIT]);
    const late = new ClaudeLineParser();
    expect(late.feed(line({ type: 'assistant', session_id: SESSION, message: { content: [] } }))).toEqual([
      { type: 'session', sessionId: SESSION },
    ]);
  });

  it('ignores a session id that could not go back on a command line', () => {
    const parser = new ClaudeLineParser();
    const noModel = { type: 'init', model: null };
    expect(parser.feed(line({ type: 'system', subtype: 'init', session_id: '--resume' }))).toEqual([noModel]);
    expect(parser.feed(line({ type: 'system', subtype: 'init', session_id: 7 }))).toEqual([noModel]);
    expect(parser.feed(init)).toEqual([{ type: 'session', sessionId: SESSION }, INIT]);
  });

  it('gives nothing for blank, partial and garbled lines, and for unknown types', () => {
    const parser = new ClaudeLineParser();
    for (const text of [
      '',
      '   ',
      '{"type":"assistant","message":{"content":[{"type":"te',
      'Warning: something odd',
      '[1,2,3]',
      line({ type: 'stream_event', event: { type: 'content_block_delta' } }),
      line({ type: 'rate_limit_event' }),
      line({ type: 'keep_alive' }),
    ]) {
      expect(parser.feed(text)).toEqual([]);
    }
  });

  it('reads each message type through its mapping', () => {
    const parser = new ClaudeLineParser();
    parser.feed(init);
    expect(parser.feed(line({ type: 'system', subtype: 'api_retry' }))).toMatchObject([{ type: 'notice' }]);
    expect(
      parser.feed(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } })),
    ).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(
      parser.feed(
        line({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] },
        }),
      ),
    ).toEqual([{ type: 'tool_result', id: 't', ok: true, summary: 'x' }]);
    expect(parser.feed(result)).toEqual([{ type: 'result', ok: true, text: 'Hi' }]);
  });
});

describe('ClaudeLineParser after the result', () => {
  it('gives nothing more: the result stays the last event', () => {
    const parser = new ClaudeLineParser();
    parser.feed(init);
    parser.feed(result);
    expect(
      parser.feed(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'late' }] } })),
    ).toEqual([]);
  });
});

describe('ClaudeLineParser with stream-json input', () => {
  const MESSAGE_ID = '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e';
  const echo = (uuid: string, text: string) =>
    line({
      type: 'user',
      isReplay: true,
      uuid,
      message: { role: 'user', content: [{ type: 'text', text }] },
    });
  const reply = line({ type: 'assistant', message: { content: [{ type: 'text', text: 'On staging.' }] } });

  it('gives an echo as input, settles at a result with nothing queued, and not before', () => {
    const parser = new ClaudeLineParser();
    parser.feed(init);
    expect(parser.settled()).toBe(false);
    expect(parser.feed(echo(MESSAGE_ID, 'Use staging'))).toEqual([
      { type: 'input', text: 'Use staging', inputId: MESSAGE_ID },
    ]);
    expect(parser.feed(reply)).toEqual([{ type: 'text', text: 'On staging.' }]);
    parser.feed(line({ type: 'result', subtype: 'success', result: 'Hi', queued_turn_count: 1 }));
    expect(parser.settled()).toBe(false);
    expect(parser.feed(reply)).toEqual([{ type: 'text', text: 'On staging.' }]);
    expect(parser.end(0, '')).toEqual([]);
    parser.feed(line({ type: 'result', subtype: 'success', result: 'Hi', queued_turn_count: 0 }));
    expect(parser.settled()).toBe(true);
    expect(parser.feed(reply)).toEqual([]);
  });

  it('goes on after the result when Claude Code takes a message as one more turn, to its own result', () => {
    const parser = new ClaudeLineParser();
    parser.feed(init);
    parser.feed(result);
    expect(parser.settled()).toBe(true);
    expect(parser.feed(reply)).toEqual([]);
    expect(parser.feed(echo(MESSAGE_ID.toUpperCase(), 'And the logs'))).toEqual([
      { type: 'input', text: 'And the logs', inputId: MESSAGE_ID },
    ]);
    expect(parser.settled()).toBe(false);
    expect(parser.feed(reply)).toEqual([{ type: 'text', text: 'On staging.' }]);
    expect(parser.end(null, '')).toEqual([
      { type: 'result', ok: false, error: 'Claude Code was stopped before it finished the turn' },
    ]);
  });

  it('ignores an echo without a usable uuid, and reads a string content', () => {
    const parser = new ClaudeLineParser();
    parser.feed(result);
    expect(
      parser.feed(line({ type: 'user', isReplay: true, uuid: 'nope', message: { content: 'x' } })),
    ).toEqual([]);
    expect(
      parser.feed(line({ type: 'user', isReplay: true, uuid: MESSAGE_ID, message: { content: 'x' } })),
    ).toEqual([{ type: 'input', text: 'x', inputId: MESSAGE_ID }]);
  });
});

describe('ClaudeLineParser.end', () => {
  it('gives nothing once a result came, whatever the exit code', () => {
    const parser = new ClaudeLineParser();
    parser.feed(init);
    parser.feed(result);
    expect(parser.end(0, '')).toEqual([]);
    expect(parser.end(1, 'late noise')).toEqual([]);
  });

  it('fails with the end of stderr when no result came', () => {
    const parser = new ClaudeLineParser();
    parser.feed(init);
    expect(parser.end(1, 'Error: Invalid API key\n')).toEqual([
      { type: 'result', ok: false, error: 'Claude Code exited with code 1: Error: Invalid API key' },
    ]);
  });

  it('falls back to the last stray line, and says when a signal stopped it or it exited 0 early', () => {
    const parser = new ClaudeLineParser();
    parser.feed('error: unknown option --effort');
    parser.feed('');
    expect(parser.end(2, '  ')).toEqual([
      { type: 'result', ok: false, error: 'Claude Code exited with code 2: error: unknown option --effort' },
    ]);
    expect(new ClaudeLineParser().end(null, '')).toEqual([
      { type: 'result', ok: false, error: 'Claude Code was stopped before it finished the turn' },
    ]);
    expect(new ClaudeLineParser().end(0, '')[0]).toMatchObject({
      error: 'Claude Code ended without finishing the turn',
    });
  });

  it('ends the subagents still running as interrupted before the failing result', () => {
    const parser = new ClaudeLineParser();
    const call = { type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { description: 'Look' } };
    parser.feed(line({ type: 'assistant', message: { content: [call] } }));
    expect(parser.end(null, '')).toMatchObject([
      { type: 'subagent', id: 'toolu_a', status: 'interrupted' },
      { type: 'result', ok: false },
    ]);
  });
});
