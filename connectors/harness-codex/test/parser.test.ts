import { describe, expect, it } from 'vitest';
import { CodexLineParser } from '../src/parser.ts';

const THREAD = '019a6f2e-8b3c-7d41-9e2a-5c8f1b4d7a63';
const line = (event: object) => JSON.stringify(event);
const message = (text: string) =>
  line({ type: 'item.completed', item: { id: 'm', type: 'agent_message', text } });
const completed = line({
  type: 'turn.completed',
  usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 7 },
});

/** The `context` a turn's total gives: the uncached input, the cache reads, marked an estimate. */
const context = (inputTokens: number, cacheReadTokens: number, outputTokens: number) => ({
  type: 'context',
  inputTokens,
  cacheReadTokens,
  cacheCreationTokens: 0,
  outputTokens,
  window: null,
  estimate: true,
});

describe('CodexLineParser.feed', () => {
  it('gives the session from thread.started, and skips an id that is no command-line word', () => {
    const parser = new CodexLineParser();
    expect(parser.feed(line({ type: 'thread.started', thread_id: THREAD }))).toEqual([
      { type: 'session', sessionId: THREAD },
    ]);
    expect(parser.feed(line({ type: 'thread.started', thread_id: '--last' }))).toEqual([]);
    expect(parser.feed(line({ type: 'thread.started' }))).toEqual([]);
  });

  it('gives the usage of turn.completed, with or without cached tokens, and none without usage', () => {
    expect(new CodexLineParser().feed(completed)).toEqual([
      { type: 'usage', inputTokens: 100, outputTokens: 7, cachedInputTokens: 80 },
      context(20, 80, 7),
    ]);
    expect(new CodexLineParser().feed(line({ type: 'turn.completed', usage: { output_tokens: 3 } }))).toEqual(
      [{ type: 'usage', inputTokens: 0, outputTokens: 3 }],
    );
    expect(new CodexLineParser().feed(line({ type: 'turn.completed' }))).toEqual([]);
  });

  it("estimates the context from the turn's total: no cached tokens, or more cached than input, stay in bounds", () => {
    const usage = (fields: object) =>
      new CodexLineParser().feed(line({ type: 'turn.completed', usage: fields }));
    expect(usage({ input_tokens: 500, output_tokens: 2 })).toEqual([
      { type: 'usage', inputTokens: 500, outputTokens: 2 },
      context(500, 0, 2),
    ]);
    expect(usage({ input_tokens: 10, cached_input_tokens: 40, output_tokens: 1 })[1]).toEqual(
      context(0, 10, 1),
    );
  });

  it('reads items, and skips items that are no object', () => {
    const parser = new CodexLineParser();
    const command = { id: 'c', type: 'command_execution', command: 'ls', status: 'in_progress' };
    expect(parser.feed(line({ type: 'item.started', item: command }))).toMatchObject([
      { type: 'tool', id: 'c' },
    ]);
    expect(parser.feed(message('Hi'))).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(parser.feed(line({ type: 'item.started', item: 'x' }))).toEqual([]);
    expect(parser.feed(line({ type: 'item.completed' }))).toEqual([]);
  });

  it('gives nothing for blank, partial and garbled lines, turn.started and unknown types', () => {
    const parser = new CodexLineParser();
    for (const text of [
      '',
      '{"type":"item.completed","item":{"id"',
      'Reading prompt from stdin...',
      line({ type: 'turn.started' }),
      line({ type: 'item.updated', item: { id: 'c', type: 'command_execution', status: 'in_progress' } }),
      line({ type: 'item.updated', item: 'x' }),
      line({ type: 'thread.compacted' }),
    ]) {
      expect(parser.feed(text)).toEqual([]);
    }
  });

  it('gives the to-do list of item.updated when it changed', () => {
    const parser = new CodexLineParser();
    const updated = line({
      type: 'item.updated',
      item: { id: 't', type: 'todo_list', items: [{ text: 'A' }] },
    });
    expect(parser.feed(updated)).toEqual([{ type: 'todo', items: [{ text: 'A', status: 'pending' }] }]);
    expect(parser.feed(updated)).toEqual([]);
  });

  it('makes an error event a notice, and fails the turn on turn.failed', () => {
    const parser = new CodexLineParser();
    expect(parser.feed(line({ type: 'error', message: 'Reconnecting... 1/5' }))).toEqual([
      { type: 'notice', level: 'warn', message: 'Reconnecting... 1/5' },
    ]);
    expect(parser.feed(line({ type: 'error', message: ' ' }))).toEqual([]);
    expect(parser.feed(line({ type: 'turn.failed', error: { message: 'stream disconnected' } }))).toEqual([
      { type: 'result', ok: false, error: 'stream disconnected' },
    ]);
    expect(parser.end(1, 'stderr')).toEqual([]);
  });

  it('fails turn.failed with the last error, or plain words, when it says nothing', () => {
    const parser = new CodexLineParser();
    parser.feed(line({ type: 'error', message: 'quota exceeded' }));
    expect(parser.feed(line({ type: 'turn.failed', error: {} }))).toEqual([
      { type: 'result', ok: false, error: 'quota exceeded' },
    ]);
    expect(new CodexLineParser().feed(line({ type: 'turn.failed' }))).toEqual([
      { type: 'result', ok: false, error: 'Codex reported that the turn failed.' },
    ]);
  });
});

describe('CodexLineParser.end', () => {
  it('ends a completed turn with a clean exit as ok, the last agent message as the reply', () => {
    const parser = new CodexLineParser();
    parser.feed(message('First.'));
    parser.feed(message('Second.'));
    parser.feed(completed);
    expect(parser.end(0, '')).toEqual([{ type: 'result', ok: true, text: 'Second.' }]);
    const silent = new CodexLineParser();
    silent.feed(completed);
    expect(silent.end(0, '')).toEqual([{ type: 'result', ok: true }]);
  });

  it('fails a completed turn that exits non-zero, with stderr', () => {
    const parser = new CodexLineParser();
    parser.feed(completed);
    expect(parser.end(1, 'panicked at main.rs')).toEqual([
      { type: 'result', ok: false, error: 'Codex exited with code 1: panicked at main.rs' },
    ]);
  });

  it('fails a turn that never completed: the last error first, then stderr, then a stray line', () => {
    const errored = new CodexLineParser();
    errored.feed(line({ type: 'error', message: 'unexpected status 401' }));
    expect(errored.end(1, 'ERROR: 401')).toEqual([
      { type: 'result', ok: false, error: 'Codex exited with code 1: unexpected status 401' },
    ]);
    const stray = new CodexLineParser();
    stray.feed('error: unexpected argument --json');
    expect(stray.end(2, '')).toEqual([
      { type: 'result', ok: false, error: 'Codex exited with code 2: error: unexpected argument --json' },
    ]);
    expect(new CodexLineParser().end(null, '')).toEqual([
      { type: 'result', ok: false, error: 'Codex was stopped before it finished the turn' },
    ]);
    expect(new CodexLineParser().end(0, '')[0]).toMatchObject({
      error: 'Codex ended without finishing the turn',
    });
  });
});
