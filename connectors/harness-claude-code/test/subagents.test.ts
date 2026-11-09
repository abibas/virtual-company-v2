import { SUBAGENT_SUMMARY_MAX, TRUNCATED_MARKER } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { newClaudeState } from '../src/state.ts';
import { interruptedSubagents, subagentAnswered, subagentStarted, taskEvents } from '../src/subagents.ts';

/** A state with one subagent started by `toolu_a` (an Explore one on haiku, in the background when asked). */
function started(input: Record<string, unknown> = {}) {
  const state = newClaudeState();
  const call = {
    id: 'toolu_a',
    name: 'Agent',
    input: { description: 'Find the parser', subagent_type: 'Explore', model: 'haiku', ...input },
  };
  const [event] = subagentStarted(call, {}, state);
  return { state, event };
}

const task = (subtype: string, fields: Record<string, unknown>) => ({ type: 'system', subtype, ...fields });

describe('subagentStarted', () => {
  it('starts one for an Agent or Task call, or any call naming a subagent type, with its parent', () => {
    expect(started().event).toEqual({
      type: 'subagent',
      id: 'toolu_a',
      agentType: 'Explore',
      description: 'Find the parser',
      model: 'haiku',
      background: false,
      status: 'running',
    });
    const state = newClaudeState();
    expect(subagentStarted({ id: 't', name: 'Task', input: null }, { parentId: 'toolu_p' }, state)).toEqual([
      {
        type: 'subagent',
        id: 't',
        agentType: 'general-purpose',
        description: '',
        background: false,
        status: 'running',
        parentId: 'toolu_p',
      },
    ]);
    expect(
      subagentStarted({ id: 'u', name: 'mcp__x', input: { subagent_type: 'Plan' } }, {}, state),
    ).toMatchObject([{ id: 'u', agentType: 'Plan' }]);
    expect(subagentStarted({ id: 'v', name: 'Bash', input: { command: 'ls' } }, {}, state)).toEqual([]);
    expect([...state.subagents.keys()]).toEqual(['t', 'u']);
  });

  it('keeps the description to one line of 200 characters and a background call as such', () => {
    const { event } = started({ description: `a\n${'b'.repeat(300)}`, run_in_background: true, model: ' ' });
    expect(event?.description).toHaveLength(200);
    expect(event).toMatchObject({ background: true });
    expect(event).not.toHaveProperty('model');
  });
});

describe('subagentAnswered', () => {
  it('ends it with its answer, without the agent id and usage Claude Code adds', () => {
    const { state } = started();
    const content = [
      { type: 'text', text: 'It is in src/parser.ts.' },
      { type: 'text', text: 'agentId: a1 (use SendMessage)\n<usage>total_tokens: 9</usage>' },
    ];
    expect(subagentAnswered('toolu_a', content, false, state)).toMatchObject([
      { status: 'done', summary: 'It is in src/parser.ts.' },
    ]);
    expect(subagentAnswered('toolu_a', 'again', false, state)).toEqual([]);
  });

  it('fails it on an error, cuts a long answer with the marker, and leaves out an empty one', () => {
    const failed = started();
    expect(subagentAnswered('toolu_a', 'boom', true, failed.state)).toMatchObject([
      { status: 'failed', summary: 'boom' },
    ]);
    const long = started();
    const [event] = subagentAnswered('toolu_a', 'z'.repeat(5000), false, long.state);
    expect(event?.summary).toHaveLength(SUBAGENT_SUMMARY_MAX);
    expect(event?.summary?.endsWith(TRUNCATED_MARKER)).toBe(true);
    const empty = started();
    expect(subagentAnswered('toolu_a', '<usage>x</usage>', false, empty.state)[0]).not.toHaveProperty(
      'summary',
    );
  });

  it('keeps one sent to the background running, and ignores a result of another call', () => {
    const { state } = started();
    expect(
      subagentAnswered('toolu_a', 'Async agent launched successfully.\nagentId: e5', false, state),
    ).toMatchObject([{ status: 'running', background: true }]);
    expect(subagentAnswered('toolu_x', 'Done', false, state)).toEqual([]);
  });
});

describe('taskEvents', () => {
  it('ties the task id to the call, then reports its steps and its end by either id', () => {
    const { state } = started();
    expect(taskEvents(task('task_started', { task_id: 'a1', tool_use_id: 'toolu_a' }), state)).toEqual([]);
    expect(
      taskEvents(task('task_progress', { task_id: 'a1', description: 'Running Grep' }), state),
    ).toMatchObject([{ status: 'running', lastStep: 'Running Grep' }]);
    expect(taskEvents(task('task_progress', { task_id: 'a1', description: 'Running Grep' }), state)).toEqual(
      [],
    );
    expect(taskEvents(task('task_progress', { task_id: 'a1', description: ' ' }), state)).toEqual([]);
    const notified = task('task_notification', { task_id: 'a1', status: 'completed', summary: 'Found it.' });
    expect(taskEvents(notified, state)).toMatchObject([
      { status: 'done', summary: 'Found it.', lastStep: 'Running Grep' },
    ]);
  });

  it('reads a backgrounded task and a status update, and a notification without a known status', () => {
    const { state } = started();
    const startedTask = task('task_started', {
      task_id: 'a1',
      tool_use_id: 'toolu_a',
      is_backgrounded: true,
    });
    expect(taskEvents(startedTask, state)).toMatchObject([{ background: true }]);
    expect(taskEvents(task('task_notification', { task_id: 'a1', status: 'pending' }), state)).toEqual([]);
    const update = task('task_updated', {
      task_id: 'a1',
      patch: { status: 'killed', description: 'Stopping' },
    });
    expect(taskEvents(update, state)).toMatchObject([{ status: 'interrupted', lastStep: 'Stopping' }]);
    expect(
      taskEvents(task('task_updated', { task_id: 'a1', patch: { status: 'completed' } }), state),
    ).toEqual([]);
  });

  it('maps failed and stopped tasks, and ignores unknown tasks and subtypes', () => {
    const failed = started();
    const failure = task('task_notification', { tool_use_id: 'toolu_a', status: 'failed' });
    expect(taskEvents(failure, failed.state)).toMatchObject([{ status: 'failed' }]);
    const stopped = started();
    for (const status of ['stopped', 'cancelled']) {
      const fresh = started();
      expect(
        taskEvents(task('task_updated', { tool_use_id: 'toolu_a', patch: { status } }), fresh.state),
      ).toMatchObject([{ status: 'interrupted' }]);
    }
    expect(taskEvents(task('task_progress', { task_id: 'unknown' }), stopped.state)).toEqual([]);
    expect(taskEvents(task('task_progress', {}), stopped.state)).toEqual([]);
    expect(taskEvents(task('task_other', { tool_use_id: 'toolu_a' }), stopped.state)).toEqual([]);
  });
});

describe('interruptedSubagents', () => {
  it('ends the subagents still running, and leaves the ended ones', () => {
    const { state } = started();
    subagentStarted({ id: 'toolu_b', name: 'Agent', input: {} }, {}, state);
    subagentAnswered('toolu_b', 'Done.', false, state);
    expect(interruptedSubagents(state)).toMatchObject([{ id: 'toolu_a', status: 'interrupted' }]);
    expect(interruptedSubagents(state)).toEqual([]);
  });
});
