import { describe, expect, it } from 'vitest';
import { parentLine } from '../../src/follow/parent.ts';
import {
  activityEvent,
  activityItem,
  line,
  NOW_S,
  SOL,
  spawnCall,
  TERRA,
  taskStarted,
} from '../fixtures/follow.ts';

describe('parentLine', () => {
  it('reads a turn’s start, in seconds or unknown', () => {
    expect(parentLine(taskStarted())).toEqual({ turnStarted: NOW_S + 1 });
    expect(parentLine(taskStarted(null))).toEqual({ turnStarted: null });
  });

  it('reads an activity written as an item (paginated) or as an event (legacy), with its model and effort', () => {
    expect(
      parentLine(activityItem('call_1', SOL, '/root/sleep_sol', 'started', 'gpt-6.1-sol', 'high')),
    ).toEqual({
      activity: {
        kind: 'started',
        threadId: SOL,
        path: '/root/sleep_sol',
        id: 'call_1',
        model: 'gpt-6.1-sol',
        effort: 'high',
      },
    });
    expect(parentLine(activityEvent('call_2', TERRA, '/root/sleep_terra', 'interrupted'))).toEqual({
      activity: { kind: 'interrupted', threadId: TERRA, path: '/root/sleep_terra', id: 'call_2' },
    });
  });

  it('reads a spawn call: its task’s first line, its model and effort, a namespaced name too', () => {
    const args = {
      task_name: 'sleep_sol',
      message: '\n  Sleep 45 seconds.\nThen report.',
      model: 'gpt-6.1-sol',
    };
    expect(parentLine(spawnCall('call_1', { ...args, reasoning_effort: 'low' }))).toEqual({
      spawn: { callId: 'call_1', description: 'Sleep 45 seconds.', model: 'gpt-6.1-sol', effort: 'low' },
    });
    expect(parentLine(spawnCall('call_2', { message: 'Go' }, 'collaboration.spawn_agent'))).toEqual({
      spawn: { callId: 'call_2', description: 'Go' },
    });
  });

  it('gives a spawn whose arguments are not JSON no description', () => {
    const encrypted = line('response_item', {
      type: 'function_call',
      name: 'spawn_agent',
      arguments: 'gAAAA…',
      call_id: 'call_3',
    });
    expect(parentLine(encrypted)).toEqual({ spawn: { callId: 'call_3', description: '' } });
  });

  it('gives nothing for other lines or ones it cannot read', () => {
    for (const text of [
      line('response_item', { type: 'message', role: 'assistant', content: 'spawn_agent' }),
      line('response_item', { type: 'function_call', name: 'wait_agent', arguments: '{}', call_id: 'c' }),
      line('response_item', { type: 'function_call', name: 'spawn_agent', arguments: '{}' }),
      line('response_item', { type: 'function_call_output', call_id: 'c', output: 'spawn_agent' }),
      line('turn_context', { model: 'x', note: '"sub_agent_activity"' }),
      line('event_msg', { type: 'item_completed', item: { type: 'AgentMessage', text: 'SubAgentActivity' } }),
      line('event_msg', {
        type: 'sub_agent_activity',
        kind: 'paused',
        agent_thread_id: SOL,
        agent_path: '/r',
      }),
      line('event_msg', { type: 'sub_agent_activity', kind: 'started', agent_path: '/root/a' }),
      line('event_msg', { type: 'sub_agent_activity', kind: 'started', agent_thread_id: SOL }),
      line('event_msg', {
        type: 'sub_agent_activity',
        kind: 'started',
        agent_thread_id: 'x'.repeat(201),
        agent_path: '/root/a',
      }),
      line('event_msg', { type: 'task_complete', turn_id: 't' }),
      '{"type":"event_msg","payload":{"type":"sub_agent_activity"',
      'not json',
    ]) {
      expect(parentLine(text)).toBeUndefined();
    }
  });

  it('leaves out an effort or model it cannot carry', () => {
    const odd = activityItem('call_1', SOL, '/root/a', 'started', ' ', 'x'.repeat(51));
    expect(parentLine(odd)).toEqual({
      activity: { kind: 'started', threadId: SOL, path: '/root/a', id: 'call_1' },
    });
  });
});
