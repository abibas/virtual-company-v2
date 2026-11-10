import { describe, expect, it } from 'vitest';
import { LiveSubagents } from '../src/follow/live.ts';
import { CodexLineParser } from '../src/parser.ts';
import type { RolloutFs } from '../src/rollout.ts';
import {
  activityItem,
  execCall,
  meta,
  ownTurn,
  PARENT,
  pathOf,
  SINCE,
  SOL,
  TERRA,
  taskStarted,
} from './fixtures/follow.ts';
import { memoryRollouts, READING } from './fixtures/rollout.ts';

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
    ]);
    expect(new CodexLineParser().feed(line({ type: 'turn.completed', usage: { output_tokens: 3 } }))).toEqual(
      [{ type: 'usage', inputTokens: 0, outputTokens: 3 }],
    );
    expect(new CodexLineParser().feed(line({ type: 'turn.completed' }))).toEqual([]);
  });

  it("estimates the context from the turn's total at the end: no cached tokens, or more cached than input, stay in bounds", () => {
    const ended = (fields: object) => {
      const parser = new CodexLineParser();
      parser.feed(line({ type: 'turn.completed', usage: fields }));
      return parser.end(0, '');
    };
    expect(ended({ input_tokens: 500, output_tokens: 2 })).toEqual([
      context(500, 0, 2),
      { type: 'result', ok: true },
    ]);
    expect(ended({ input_tokens: 10, cached_input_tokens: 40, output_tokens: 1 })[0]).toEqual(
      context(0, 10, 1),
    );
    expect(ended({ output_tokens: 3 })).toEqual([{ type: 'result', ok: true }]);
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
    expect(parser.end(0, '')).toEqual([context(20, 80, 7), { type: 'result', ok: true, text: 'Second.' }]);
    const silent = new CodexLineParser();
    silent.feed(completed);
    expect(silent.end(0, '')).toEqual([context(20, 80, 7), { type: 'result', ok: true }]);
  });

  it('fails a completed turn that exits non-zero, with stderr', () => {
    const parser = new CodexLineParser();
    parser.feed(completed);
    expect(parser.end(1, 'panicked at main.rs')).toEqual([
      context(20, 80, 7),
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

describe("CodexLineParser with Codex's own reading", () => {
  const started = line({ type: 'thread.started', thread_id: THREAD });
  const exact = {
    type: 'context',
    inputTokens: 2257,
    cacheReadTokens: 33_152,
    cacheCreationTokens: 0,
    outputTokens: 456,
    window: 475_000,
    usedTokens: 35_865,
    baselineTokens: 12_000,
    model: 'gpt-6.1-sol',
  };

  it("ends the turn with the thread's reading in place of the estimate", () => {
    const asked: string[] = [];
    const parser = new CodexLineParser((thread) => {
      asked.push(thread);
      return READING;
    });
    parser.feed(started);
    parser.feed(completed);
    expect(parser.end(0, '')).toEqual([exact, { type: 'result', ok: true }]);
    expect(asked).toEqual([THREAD]);
  });

  it('reads it for a turn that failed or was stopped too', () => {
    const failed = new CodexLineParser(() => READING);
    failed.feed(started);
    failed.feed(line({ type: 'turn.failed', error: { message: 'stream disconnected' } }));
    expect(failed.end(1, '')).toEqual([exact]);
    const stopped = new CodexLineParser(() => READING);
    stopped.feed(started);
    expect(stopped.end(null, '')).toEqual([
      exact,
      { type: 'result', ok: false, error: 'Codex was stopped before it finished the turn' },
    ]);
  });

  it('keeps the estimate when there is no reading, the read fails, or no thread started', () => {
    const none = new CodexLineParser(() => undefined);
    none.feed(started);
    none.feed(completed);
    expect(none.end(0, '')[0]).toEqual(context(20, 80, 7));
    const throwing = new CodexLineParser(() => {
      throw new Error('EACCES');
    });
    throwing.feed(started);
    throwing.feed(completed);
    expect(throwing.end(0, '')[0]).toEqual(context(20, 80, 7));
    const asked: string[] = [];
    const threadless = new CodexLineParser((thread) => {
      asked.push(thread);
      return READING;
    });
    threadless.feed(completed);
    expect(threadless.end(0, '')[0]).toEqual(context(20, 80, 7));
    expect(asked).toEqual([]);
  });
});

describe('CodexLineParser: subagents', () => {
  const CHILD = '019a6f2f-1a20-7b31-8c4d-2e6f0a9b3c51';
  const spawn = line({
    type: 'item.completed',
    item: {
      id: 's',
      type: 'collab_tool_call',
      tool: 'spawn_agent',
      sender_thread_id: THREAD,
      receiver_thread_ids: [CHILD],
      prompt: 'Sleep a while.',
      agents_states: { [CHILD]: { status: 'running', message: null } },
      status: 'completed',
    },
  });
  const child = (status: string, more: object = {}) => ({
    type: 'subagent',
    id: CHILD,
    agentType: 'Codex agent',
    description: 'Sleep a while.',
    background: true,
    status,
    ...more,
  });

  it('starts a subagent from a collab call, and interrupts it before turn.failed’s result', () => {
    const parser = new CodexLineParser();
    expect(
      parser.feed(line({ type: 'item.started', item: { type: 'collab_tool_call', status: 'in_progress' } })),
    ).toEqual([]);
    expect(parser.feed(spawn)).toEqual([child('running')]);
    expect(parser.feed(line({ type: 'turn.failed', error: { message: 'stream disconnected' } }))).toEqual([
      child('interrupted'),
      { type: 'result', ok: false, error: 'stream disconnected' },
    ]);
    expect(parser.end(1, '')).toEqual([]);
  });

  it('reads the subagent with readChild when the process ends without completing the turn', () => {
    const parser = new CodexLineParser(undefined, () => ({ model: 'gpt-5.5' }));
    parser.feed(spawn);
    const events = parser.end(1, 'killed');
    expect(events[0]).toEqual(child('interrupted', { model: 'gpt-5.5' }));
    expect(events[1]).toMatchObject({ type: 'result', ok: false });
  });
});

describe('CodexLineParser: following the session files while the turn runs', () => {
  const HOME = '/state/codex/abc';
  const started = line({ type: 'thread.started', thread_id: PARENT });
  const sub = (id: string, agentType: string, status: string, more: object = {}) => ({
    type: 'subagent',
    id,
    agentType,
    description: '',
    background: true,
    status,
    ...more,
  });

  /** A parser following files in memory, the agent's file there from the start. */
  function following(fs?: RolloutFs) {
    const files: Record<string, string> = { [pathOf(HOME, PARENT)]: `${meta(PARENT)}\n` };
    const memory = memoryRollouts(files);
    const parser = new CodexLineParser(
      undefined,
      undefined,
      (state) => new LiveSubagents({ fs: fs ?? memory.fs, home: HOME, since: SINCE }, state),
    );
    const append = (id: string, lines: readonly string[]) => {
      files[pathOf(HOME, id)] = (files[pathOf(HOME, id)] ?? '') + lines.map((text) => `${text}\n`).join('');
    };
    return { parser, append, memory };
  }

  it('gives nothing on a tick without following, or before the thread started', () => {
    expect(new CodexLineParser().tick()).toEqual([]);
    expect(following().parser.tick()).toEqual([]);
  });

  it('gives subagents and their steps between lines, and reads once more as the turn ends', () => {
    const { parser, append } = following();
    expect(parser.feed(started)).toEqual([{ type: 'session', sessionId: PARENT }]);
    append(PARENT, [
      taskStarted(),
      activityItem('c1', SOL, '/root/sleep_sol', 'started', 'gpt-6.1-sol', 'high'),
    ]);
    const sol = sub(SOL, 'sleep_sol', 'running', { model: 'gpt-6.1-sol', effort: 'high' });
    expect(parser.tick()).toEqual([sol]);
    append(SOL, [meta(SOL, 'paginated', PARENT), ownTurn(), execCall('k1', 'sleep 45')]);
    expect(parser.tick()).toEqual([
      { type: 'tool', id: `${SOL}:k1`, name: 'command', summary: 'sleep 45', parentId: SOL },
    ]);
    parser.feed(completed);
    append(PARENT, [
      activityItem('c2', TERRA, '/root/sleep_terra', 'started'),
      activityItem('d2', TERRA, '/root/sleep_terra', 'completed'),
    ]);
    expect(parser.end(0, '')).toEqual([
      context(20, 80, 7),
      sub(TERRA, 'sleep_terra', 'running'),
      sub(TERRA, 'sleep_terra', 'done'),
      { ...sol, status: 'interrupted' },
      { type: 'result', ok: true },
    ]);
    expect(parser.tick()).toEqual([]);
  });

  it('reads once more before turn.failed’s result, and not after it', () => {
    const { parser, append } = following();
    parser.feed(started);
    append(PARENT, [taskStarted(), activityItem('c1', SOL, '/root/sleep_sol', 'started')]);
    expect(parser.feed(line({ type: 'turn.failed', error: { message: 'stream disconnected' } }))).toEqual([
      sub(SOL, 'sleep_sol', 'running'),
      sub(SOL, 'sleep_sol', 'interrupted'),
      { type: 'result', ok: false, error: 'stream disconnected' },
    ]);
    append(PARENT, [activityItem('c2', TERRA, '/root/sleep_terra', 'started')]);
    expect(parser.tick()).toEqual([]);
    expect(parser.end(1, '')).toEqual([]);
  });

  it('stops following when reading fails, never the turn', () => {
    const failing: RolloutFs = {
      list: () => {
        throw new Error('EACCES');
      },
      tail: () => undefined,
      readAt: () => undefined,
    };
    const { parser } = following(failing);
    expect(parser.feed(started)).toEqual([{ type: 'session', sessionId: PARENT }]);
    expect(parser.tick()).toEqual([]);
    parser.feed(completed);
    expect(parser.end(0, '')).toEqual([context(20, 80, 7), { type: 'result', ok: true }]);
  });
});
