import { describe, expect, it } from 'vitest';
import { childLine } from '../../src/follow/child.ts';
import {
  callOutput,
  commandItem,
  execCall,
  line,
  messageEvent,
  messageItem,
  meta,
  NOW_S,
  ownTurn,
  PARENT,
  SOL,
  taskComplete,
  taskStarted,
} from '../fixtures/follow.ts';

const call = (name: string, args: object) =>
  line('response_item', { type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'c1' });

describe('childLine', () => {
  it('reads its history mode and its turns’ starts', () => {
    expect(childLine(meta(SOL, 'paginated', PARENT))).toEqual({ kind: 'meta', paginated: true });
    expect(childLine(meta(SOL, 'legacy', PARENT))).toEqual({ kind: 'meta', paginated: false });
    expect(childLine(taskStarted())).toEqual({ kind: 'turn', startedAt: NOW_S + 1, root: true });
    expect(childLine(ownTurn())).toEqual({ kind: 'turn', startedAt: NOW_S + 1, root: false });
    expect(childLine(taskStarted(null, false))).toEqual({ kind: 'turn', startedAt: null, root: false });
  });

  it('reads a command’s start from each call that runs one', () => {
    const started = (command: string) => ({ kind: 'call', callId: 'c1', command });
    expect(childLine(execCall('c1', 'sleep 45'))).toEqual(started('sleep 45'));
    expect(childLine(call('shell', { command: ['bash', '-lc', 'ls -la'] }))).toEqual(started('ls -la'));
    expect(childLine(call('container.exec', { command: ['python3', 'a.py'] }))).toEqual(
      started('python3 a.py'),
    );
    expect(childLine(call('shell_command', { command: ' pwd ' }))).toEqual(started('pwd'));
    const local = line('response_item', {
      type: 'local_shell_call',
      call_id: 'c1',
      status: 'in_progress',
      action: { type: 'exec', command: ['ls'] },
    });
    expect(childLine(local)).toEqual(started('ls'));
  });

  it('skips calls that run no command, or name none', () => {
    for (const text of [
      call('apply_patch', { input: '*** Begin Patch' }),
      call('write_stdin', { session_id: 1, chars: '' }),
      call('exec_command', { cmd: '  ' }),
      line('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}' }),
      line('response_item', { type: 'local_shell_call', call_id: 'c1', action: 'exec' }),
    ]) {
      expect(childLine(text)).toBeUndefined();
    }
  });

  it('reads a command’s end with its result, as the exec stream words one', () => {
    expect(childLine(commandItem('c1', ['/bin/zsh', '-lc', 'sleep 45']))).toEqual({
      kind: 'done',
      callId: 'c1',
      command: 'sleep 45',
      ok: true,
      summary: 'exit 0',
    });
    expect(childLine(commandItem('c2', ['false'], 1, 'boom\n'))).toEqual({
      kind: 'done',
      callId: 'c2',
      command: 'false',
      ok: false,
      summary: 'exit 1: boom',
    });
    const older = line('event_msg', {
      type: 'exec_command_end',
      call_id: 'c3',
      command: ['ls'],
      exit_code: 0,
    });
    expect(childLine(older)).toMatchObject({ kind: 'done', callId: 'c3', ok: true, summary: 'exit 0' });
    const running = line('event_msg', {
      type: 'item_completed',
      item: { type: 'CommandExecution', id: 'c4', command: ['ls'], status: 'in_progress' },
    });
    expect(childLine(running)).toBeUndefined();
  });

  it('reads a call’s output, as a line or as content items', () => {
    expect(childLine(callOutput('c1', 'Exit code: 0'))).toEqual({
      kind: 'output',
      callId: 'c1',
      output: 'Exit code: 0',
    });
    const items = callOutput('c1', [{ type: 'input_text', text: 'a' }, { type: 'input_image' }, 'x']);
    expect(childLine(items)).toEqual({ kind: 'output', callId: 'c1', output: 'a\n\n' });
    expect(childLine(callOutput('c1', 7))).toEqual({ kind: 'output', callId: 'c1', output: '' });
    expect(childLine(line('response_item', { type: 'function_call_output', output: 'x' }))).toBeUndefined();
  });

  it('reads its messages and its turn’s end', () => {
    expect(childLine(messageItem('Slept.'))).toEqual({ kind: 'message', text: 'Slept.' });
    expect(childLine(messageEvent('Sleeping now.'))).toEqual({ kind: 'message', text: 'Sleeping now.' });
    expect(childLine(messageEvent('  '))).toBeUndefined();
    expect(childLine(taskComplete('Slept 45 seconds.'))).toEqual({
      kind: 'end',
      answer: 'Slept 45 seconds.',
      error: undefined,
    });
    expect(childLine(taskComplete(null, 'usage limit reached'))).toEqual({
      kind: 'end',
      answer: undefined,
      error: 'usage limit reached',
    });
  });

  it('gives nothing for other lines', () => {
    for (const text of [
      line('turn_context', { model: 'gpt-6.1-sol' }),
      line('event_msg', { type: 'item_completed', item: { type: 'Reasoning', text: 'AgentMessage' } }),
      line('event_msg', { type: 'token_count', note: 'task_complete' }),
      line('compacted', { message: '"agent_message"' }),
      '{"type":"session_meta"',
    ]) {
      expect(childLine(text)).toBeUndefined();
    }
  });
});
