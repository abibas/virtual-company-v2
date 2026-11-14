import { THINKING_MAX, TOOL_RESULT_SUMMARY_MAX, TRUNCATED_MARKER } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { assistantEvents, resultEvents, todoEvent, userEvents } from '../src/messages.ts';
import { newClaudeState } from '../src/state.ts';

const assistant = (content: unknown, parent: string | null = null) => ({
  type: 'assistant',
  message: { role: 'assistant', content },
  parent_tool_use_id: parent,
});
const user = (content: unknown, parent: string | null = null) => ({
  type: 'user',
  message: { role: 'user', content },
  parent_tool_use_id: parent,
});

describe('assistantEvents', () => {
  it('gives the text and thinking blocks and the tool calls, in order', () => {
    const events = assistantEvents(
      assistant([
        { type: 'thinking', thinking: 'hmm', signature: 's' },
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/w/a.ts' } },
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'zod' } },
      ]),
    );
    expect(events).toEqual([
      { type: 'thinking', text: 'hmm' },
      { type: 'text', text: 'Let me look.' },
      { type: 'tool', id: 'toolu_1', name: 'Read', summary: '/w/a.ts' },
      { type: 'tool', id: 'srvtoolu_1', name: 'web_search', summary: 'zod' },
    ]);
  });

  it('skips blank text and thinking, calls without an id and odd blocks, and marks a subagent’s', () => {
    expect(
      assistantEvents(
        assistant([
          { type: 'text', text: '  \n' },
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'redacted_thinking', data: 'x' },
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', id: '' },
          'x',
          null,
        ]),
      ),
    ).toEqual([]);
    expect(assistantEvents(assistant([{ type: 'text', text: 'inner' }], 'toolu_task'))).toEqual([
      { type: 'text', text: 'inner', parentId: 'toolu_task' },
    ]);
    expect(assistantEvents({ type: 'assistant' })).toEqual([]);
    expect(assistantEvents({ type: 'assistant', message: { content: 'text' } })).toEqual([]);
  });

  it('names a call without a name `tool`', () => {
    expect(assistantEvents(assistant([{ type: 'tool_use', id: 't', input: {} }]))).toEqual([
      { type: 'tool', id: 't', name: 'tool', summary: '' },
    ]);
  });
});

describe('userEvents', () => {
  it('gives each tool result, ok unless it is an error', () => {
    const events = userEvents(
      user([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'index.ts' },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: [{ type: 'text', text: 'denied' }],
          is_error: true,
        },
        { type: 'text', text: 'not a result' },
        { type: 'tool_result', content: 'no id' },
      ]),
    );
    expect(events).toEqual([
      { type: 'tool_result', id: 'toolu_1', ok: true, summary: 'index.ts' },
      { type: 'tool_result', id: 'toolu_2', ok: false, summary: 'denied' },
    ]);
  });

  it('marks a subagent’s results, and gives nothing for a plain user message', () => {
    expect(userEvents(user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }], 'toolu_task'))).toEqual(
      [{ type: 'tool_result', id: 't', ok: true, summary: 'x', parentId: 'toolu_task' }],
    );
    expect(userEvents(user('a plain message'))).toEqual([]);
  });

  it('keeps a result’s whole text beside its summary when the summary cut it (the full trace)', () => {
    const long = `${'line of output\n'.repeat(60)}the end`;
    const [event] = userEvents(user([{ type: 'tool_result', tool_use_id: 't', content: long }]));
    expect(event).toMatchObject({ type: 'tool_result', id: 't', ok: true, output: long });
    expect((event as { summary: string }).summary.length).toBeLessThanOrEqual(TOOL_RESULT_SUMMARY_MAX);
  });
});

describe('a call’s whole input (the full trace)', () => {
  it('rides on the call unless its summary says it all; a to-do list’s never does', () => {
    const edit = { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' };
    const events = assistantEvents(
      assistant([
        { type: 'tool_use', id: 'e', name: 'Edit', input: edit },
        { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/w/a.ts' } },
        { type: 'tool_use', id: 'd', name: 'TodoWrite', input: { todos: [] } },
      ]),
    );
    expect(events.filter((event) => event.type === 'tool')).toEqual([
      { type: 'tool', id: 'e', name: 'Edit', summary: '/w/a.ts', input: JSON.stringify(edit, null, 2) },
      { type: 'tool', id: 'r', name: 'Read', summary: '/w/a.ts' },
      { type: 'tool', id: 'd', name: 'TodoWrite', summary: '0 to-dos' },
    ]);
  });
});

describe('resultEvents', () => {
  const success = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2310,
    result: 'Done.',
    total_cost_usd: 0.03,
    usage: {
      input_tokens: 3,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 2000,
      output_tokens: 9,
    },
    permission_denials: [],
  };

  it('gives the usage (cache reads and writes counted as input) and the reply', () => {
    expect(resultEvents(success)).toEqual([
      { type: 'usage', inputTokens: 2103, outputTokens: 9, cachedInputTokens: 2000, costUsd: 0.03 },
      { type: 'result', ok: true, text: 'Done.', durationMs: 2310 },
    ]);
  });

  it('puts a notice per refused tool before the usage', () => {
    const events = resultEvents({
      ...success,
      permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, 'odd'],
    });
    expect(events.map((event) => event.type)).toEqual(['notice', 'usage', 'result']);
    expect(events[0]).toMatchObject({ message: 'Refused for permission: Bash (rm -rf build)' });
  });

  it('fails with the result text, the errors, or the subtype', () => {
    expect(
      resultEvents({ ...success, is_error: true, result: 'Invalid API key · Please run /login' }).at(-1),
    ).toEqual({
      type: 'result',
      ok: false,
      error: 'Invalid API key · Please run /login',
      durationMs: 2310,
    });
    const failed = (extra: object) => resultEvents({ type: 'result', ...extra }).at(-1);
    expect(failed({ subtype: 'error_during_execution', errors: ['boom', 1, 'bang'] })).toEqual({
      type: 'result',
      ok: false,
      error: 'boom; bang',
    });
    expect(failed({ subtype: 'error_max_turns' })).toMatchObject({
      error: 'The turn reached its limit of turns.',
    });
    expect(failed({ subtype: 'error_max_budget_usd' })).toMatchObject({
      error: 'The turn reached its budget.',
    });
    expect(failed({ subtype: 'error_during_execution', result: ' ' })).toMatchObject({
      error: 'Claude Code failed during the turn.',
    });
    expect(failed({ subtype: 'error_new_kind' })).toMatchObject({
      error: 'Claude Code ended the turn with error_new_kind.',
    });
    expect(failed({ is_error: true })).toMatchObject({ error: 'Claude Code reported an error.' });
    expect(failed({ subtype: 'success', is_error: true })).toMatchObject({
      error: 'Claude Code reported an error.',
    });
  });

  it('gives no usage without one, no cost when it is not a number, and no empty reply', () => {
    expect(resultEvents({ type: 'result', subtype: 'success', result: '' })).toEqual([
      { type: 'result', ok: true },
    ]);
    expect(resultEvents({ type: 'result', total_cost_usd: 0.5 })[0]).toEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0.5,
    });
    expect(resultEvents({ type: 'result', usage: {}, total_cost_usd: -1 })[0]).toEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
  });
});

describe('the richer events of messages', () => {
  it('cuts a long thinking text to its limit, ending in the marker', () => {
    const [event] = assistantEvents(
      assistant([{ type: 'thinking', thinking: 'x'.repeat(THINKING_MAX + 5) }]),
    );
    const text = (event as { text: string }).text;
    expect(text).toHaveLength(THINKING_MAX);
    expect(text.endsWith(TRUNCATED_MARKER)).toBe(true);
  });

  it('gives a TodoWrite call as the tool and its list, a subagent’s with its parentId', () => {
    const input = {
      todos: [
        { content: 'Read the spec', status: 'completed', activeForm: 'Reading' },
        { content: '  Write\nthe parser ', status: 'in_progress' },
        { content: 'Ship', status: 'later' },
        { content: ' ', status: 'pending' },
        'odd',
      ],
    };
    const call = { type: 'tool_use', id: 't', name: 'TodoWrite', input };
    expect(assistantEvents(assistant([call], 'toolu_a'))).toEqual([
      { type: 'tool', id: 't', name: 'TodoWrite', summary: '5 to-dos', parentId: 'toolu_a' },
      {
        type: 'todo',
        items: [
          { text: 'Read the spec', status: 'completed' },
          { text: 'Write the parser', status: 'in_progress' },
          { text: 'Ship', status: 'pending' },
        ],
        parentId: 'toolu_a',
      },
    ]);
  });

  it('keeps a to-do list to 100 items of 300 characters, and gives none for a call without a list', () => {
    const todos = Array.from({ length: 120 }, (_, i) => ({
      content: `${i} ${'y'.repeat(400)}`,
      status: 'pending',
    }));
    const [event] = todoEvent({ todos }, {});
    expect(event?.items).toHaveLength(100);
    expect(event?.items[0]?.text).toHaveLength(300);
    expect(todoEvent({ todos: 'no' }, {})).toEqual([]);
    expect(todoEvent(null, {})).toEqual([]);
    expect(todoEvent({ todos: [] }, {})).toEqual([{ type: 'todo', items: [] }]);
  });

  it('starts a subagent on an Agent call and ends it with the call’s result', () => {
    const state = newClaudeState();
    const call = {
      type: 'tool_use',
      id: 'toolu_a',
      name: 'Agent',
      input: { description: 'Look', prompt: 'p' },
    };
    const subagent = {
      type: 'subagent',
      id: 'toolu_a',
      agentType: 'general-purpose',
      description: 'Look',
      background: false,
    };
    expect(assistantEvents(assistant([call]), state)).toEqual([
      {
        type: 'tool',
        id: 'toolu_a',
        name: 'Agent',
        summary: 'Look',
        input: JSON.stringify({ description: 'Look', prompt: 'p' }, null, 2),
      },
      { ...subagent, status: 'running' },
    ]);
    const answer = user([{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'Found it.' }]);
    expect(userEvents(answer, state)).toEqual([
      { type: 'tool_result', id: 'toolu_a', ok: true, summary: 'Found it.' },
      { ...subagent, status: 'done', summary: 'Found it.' },
    ]);
  });

  it('says how full the context is after a message with its usage', () => {
    const usage = {
      input_tokens: 3,
      cache_read_input_tokens: 14000,
      cache_creation_input_tokens: 0,
      output_tokens: 9,
    };
    const message = {
      type: 'assistant',
      message: { id: 'msg_1', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Hi' }], usage },
    };
    expect(assistantEvents(message).at(-1)).toEqual({
      type: 'context',
      inputTokens: 3,
      cacheReadTokens: 14000,
      cacheCreationTokens: 0,
      outputTokens: 9,
      window: 1_000_000,
    });
  });

  it('ends the turn with the subagents still running as interrupted, then the context and the result', () => {
    const state = newClaudeState();
    assistantEvents(assistant([{ type: 'tool_use', id: 'toolu_a', name: 'Task', input: {} }]), state);
    state.context = {
      type: 'context',
      inputTokens: 3,
      cacheReadTokens: 100,
      cacheCreationTokens: 0,
      outputTokens: 1,
      window: null,
    };
    const result = {
      type: 'result',
      subtype: 'success',
      result: 'ok',
      modelUsage: { m: { contextWindow: 200_000 } },
    };
    const events = resultEvents(result, state);
    expect(events.map((event) => event.type)).toEqual(['subagent', 'context', 'result']);
    expect(events[0]).toMatchObject({ id: 'toolu_a', status: 'interrupted' });
    expect(events[1]).toMatchObject({ window: 200_000 });
  });

  it("ends the result with the main agent's last message uuid, never a subagent's or one that is not a word", () => {
    const state = newClaudeState();
    const text = [{ type: 'text', text: 'Hi' }];
    assistantEvents({ ...assistant(text), uuid: 'c0a80101-first' }, state);
    assistantEvents({ ...assistant(text), uuid: 'c0a80101-last' }, state);
    assistantEvents({ ...assistant(text, 'toolu_sub'), uuid: 'c0a80101-subagent' }, state);
    assistantEvents({ ...assistant(text), uuid: '-p' }, state);
    assistantEvents(assistant(text), state);
    const result = { type: 'result', subtype: 'success', result: 'ok' };
    expect(resultEvents(result, state).at(-1)).toEqual({
      type: 'result',
      ok: true,
      text: 'ok',
      messageId: 'c0a80101-last',
    });
    expect(resultEvents(result).at(-1)).not.toHaveProperty('messageId');
  });
});
