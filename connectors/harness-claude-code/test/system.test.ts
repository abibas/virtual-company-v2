import { describe, expect, it } from 'vitest';
import { newClaudeState } from '../src/state.ts';
import { systemEvents } from '../src/system.ts';

describe('systemEvents', () => {
  it('turns an API retry into an info notice', () => {
    const retry = { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, error_status: 529 };
    expect(systemEvents(retry)).toEqual([
      {
        type: 'notice',
        level: 'info',
        message: 'The request to the model failed and is retried (attempt 2 of 10): HTTP 529',
      },
    ]);
    expect(systemEvents({ subtype: 'api_retry', error: 'overloaded_error' })[0]).toMatchObject({
      message: 'The request to the model failed and is retried: overloaded_error',
    });
    expect(systemEvents({ subtype: 'api_retry' })[0]).toMatchObject({
      message: 'The request to the model failed and is retried',
    });
  });

  it('gives nothing for the other system messages', () => {
    expect(systemEvents({ type: 'system', subtype: 'status', status: 'compacting' })).toEqual([]);
    expect(systemEvents({ type: 'system', subtype: 'hook_response' })).toEqual([]);
    expect(systemEvents({ type: 'system' })).toEqual([]);
  });
});

describe('systemEvents: init', () => {
  it('gives the model, the effort, the folder and the slash commands, and keeps the model', () => {
    const state = newClaudeState();
    const init = {
      type: 'system',
      subtype: 'init',
      session_id: 's',
      model: 'claude-opus-5-5[1m]',
      effort: 'high',
      cwd: '/home/agent/work',
      slash_commands: ['compact', '/review', '', 7, 'c'.repeat(101), '  context  '],
    };
    expect(systemEvents(init, state)).toEqual([
      {
        type: 'init',
        model: 'claude-opus-5-5[1m]',
        effort: 'high',
        cwd: '/home/agent/work',
        slashCommands: ['compact', 'review', 'context'],
      },
    ]);
    expect(state.model).toBe('claude-opus-5-5[1m]');
  });

  it('says null for a missing model, leaves out what is missing or too long, and keeps 200 commands', () => {
    const state = newClaudeState();
    state.model = 'opus';
    expect(systemEvents({ subtype: 'init', model: '  ', cwd: `/${'x'.repeat(4096)}` }, state)).toEqual([
      { type: 'init', model: null },
    ]);
    expect(state.model).toBe('opus');
    const many = systemEvents({
      subtype: 'init',
      model: 'm'.repeat(201),
      slash_commands: Array.from({ length: 250 }, (_, i) => `c${i}`),
    })[0];
    expect(many).toMatchObject({ type: 'init', model: null });
    expect((many as { slashCommands: string[] }).slashCommands).toHaveLength(200);
  });
});

describe('systemEvents: compact_boundary', () => {
  it('gives the sizes before and after and who asked, and forgets the last context', () => {
    const state = newClaudeState();
    state.contextKey = 'k';
    state.context = {
      type: 'context',
      inputTokens: 1,
      cacheReadTokens: 2,
      cacheCreationTokens: 3,
      outputTokens: 4,
      window: null,
    };
    const boundary = {
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 160_000, post_tokens: 21_000 },
    };
    expect(systemEvents(boundary, state)).toEqual([
      { type: 'compact', preTokens: 160_000, postTokens: 21_000, trigger: 'auto' },
    ]);
    expect(state.context).toBeUndefined();
    expect(state.contextKey).toBeUndefined();
  });

  it('says null for an unknown size after, and leaves out an unknown trigger', () => {
    expect(
      systemEvents({ subtype: 'compact_boundary', compact_metadata: { pre_tokens: 9, trigger: 'x' } }),
    ).toEqual([{ type: 'compact', preTokens: 9, postTokens: null }]);
    expect(systemEvents({ subtype: 'compact_boundary' })).toEqual([
      { type: 'compact', preTokens: 0, postTokens: null },
    ]);
  });
});

describe('systemEvents: task messages', () => {
  it('report the subagents the turn started, and nothing for another task', () => {
    const state = newClaudeState();
    state.subagents.set('toolu_a', {
      id: 'toolu_a',
      agentType: 'Explore',
      description: 'Look',
      background: false,
      status: 'running',
    });
    expect(
      systemEvents({ subtype: 'task_progress', tool_use_id: 'toolu_a', description: 'Running Grep' }, state),
    ).toMatchObject([{ type: 'subagent', id: 'toolu_a', lastStep: 'Running Grep' }]);
    for (const subtype of ['task_started', 'task_updated', 'task_notification']) {
      expect(systemEvents({ subtype, task_id: 'bash_1', tool_use_id: 'toolu_bash' }, state)).toEqual([]);
    }
  });
});
